package cz.artefaktlab.masterlab;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.os.Process;
import org.json.JSONObject;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.TreeMap;
import java.util.Arrays;

/**
 * MASTER LAB 3.0 LAN PCM transport proof-of-concept, 48 kHz PCM16 stereo.
 * Fixed 240-frame (5 ms) datagrams < 1200 bytes, 200 packets/second.
 * Network jitter/drop management and two independent Android AudioTracks.
 * Intended for LAN tests, not a guaranteed low-latency stage-grade transport.
 */
public final class NativeLanAudio {
    private static final int RATE=48000, FRAMES=240, CHANNELS=2, SAMPLES=FRAMES*CHANNELS;
    private static final int BODY=SAMPLES*2, HEADER=16, PACKET=HEADER+BODY;
    private static final int MAGIC=0x4d4c3341;
    private final Activity activity;
    private final AudioManager audio;
    private volatile boolean sending=false,receiving=false;
    private volatile String txStatus="OFF",rxStatus="OFF";
    private volatile int txDevice=-1,rxDeviceA=-1,rxDeviceB=-1,routeA=-1,routeB=-1;
    private volatile float[] matrixA={1,0,0,1},matrixB={1,0,0,1};
    private volatile long sent=0,received=0,missing=0,late=0,underruns=0,malformed=0,skipped=0,bytes=0;
    private volatile int queueDepth=0,targetPackets=8;
    private volatile int actualRate=RATE;
    private Thread sender,listener,player;
    private DatagramSocket txSocket,rxSocket;
    private AudioRecord record;
    private AudioTrack outputA,outputB;
    private final TreeMap<Integer,short[]> packets=new TreeMap<>();
    private final Object lock=new Object();

    public NativeLanAudio(Activity activity){
        this.activity=activity;audio=(AudioManager)activity.getSystemService(Activity.AUDIO_SERVICE);
    }
    private AudioDeviceInfo device(int id,boolean input){
        if(audio==null)return null;
        for(AudioDeviceInfo d:audio.getDevices(input?AudioManager.GET_DEVICES_INPUTS:AudioManager.GET_DEVICES_OUTPUTS))
            if(d.getId()==id && (input?d.isSource():d.isSink()))return d;
        return null;
    }
    private static short clip(float n){return (short)Math.min(32767,Math.max(-32768,Math.round(n)));}
    private static float cap(float v){return Float.isFinite(v)?Math.max(0,Math.min(2,v)):0;}
    public void setGains(float all,float arl,float alr,float arr,float bll,float brl,float blr,float brr){
        matrixA=new float[]{cap(all),cap(arl),cap(alr),cap(arr)};
        matrixB=new float[]{cap(bll),cap(brl),cap(blr),cap(brr)};
    }
    private AudioTrack openTrack(AudioDeviceInfo dev){
        AudioFormat f=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
        int min=AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_STEREO,AudioFormat.ENCODING_PCM_16BIT);
        if(min<=0)throw new IllegalStateException("48k stereo playback unsupported");
        AudioTrack t=new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(f).setBufferSizeInBytes(Math.max(min*2,BODY*6))
            .setTransferMode(AudioTrack.MODE_STREAM).build();
        if(t.getState()!=AudioTrack.STATE_INITIALIZED){t.release();throw new IllegalStateException("AudioTrack init failed");}
        if(!t.setPreferredDevice(dev)){t.release();throw new IllegalStateException("Android refused output selection");}
        return t;
    }
    private static void close(AudioTrack t){
        if(t!=null){try{t.pause();t.flush();t.release();}catch(Exception ignored){}}
    }
    public synchronized String startSender(String host,int port,int selectedInput){
        stopSender();
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)
            return txStatus="MIC INPUT PERMISSION REQUIRED";
        if(port<1024||port>65535)return txStatus="INVALID PORT 1024–65535";
        AudioDeviceInfo source=device(selectedInput,true);
        if(source==null)return txStatus="SELECT PHYSICAL AUDIO INPUT";
        try{
            InetAddress address=InetAddress.getByName(host.trim());
            if(!(address instanceof Inet4Address)||address.isMulticastAddress()||address.isAnyLocalAddress())
                return txStatus="USE A VALID UNICAST IPv4 ADDRESS";
            int min=AudioRecord.getMinBufferSize(RATE,AudioFormat.CHANNEL_IN_STEREO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0)return txStatus="48K STEREO CAPTURE UNSUPPORTED";
            AudioFormat f=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
            int src=MediaRecorder.AudioSource.MIC;
            if("true".equalsIgnoreCase(audio.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)))
                src=MediaRecorder.AudioSource.UNPROCESSED;
            record=new AudioRecord.Builder().setAudioSource(src).setAudioFormat(f)
                .setBufferSizeInBytes(Math.max(min*2,BODY*8)).build();
            if(record.getState()!=AudioRecord.STATE_INITIALIZED)throw new IllegalStateException("AudioRecord initialization failed");
            if(!record.setPreferredDevice(source))throw new IllegalStateException("Android refused input selection");
            record.startRecording();
            AudioDeviceInfo routed=record.getRoutedDevice();
            txDevice=routed==null?-1:routed.getId();
            if(txDevice!=selectedInput)throw new IllegalStateException("Actual input route differs: "+txDevice);
            txSocket=new DatagramSocket();
            sending=true;sent=0;bytes=0;txStatus="TRANSMITTING";
            sender=new Thread(()->transmit(address,port),"MASTER-LAB-LAN-TX");sender.start();
        }catch(Exception ex){
            txStatus="TX FAILED: "+ex.getMessage();
            releaseSender();
        }
        return txStatus;
    }
    private void transmit(InetAddress destination,int port){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] pcm=new short[SAMPLES];byte[] data=new byte[PACKET];int seq=0;
        try{
            while(sending){
                int read=0;
                while(sending&&read<pcm.length){
                    int n=record.read(pcm,read,pcm.length-read,AudioRecord.READ_BLOCKING);
                    if(n<=0)throw new IllegalStateException("Capture failed: "+n);
                    read+=n;
                }
                if(!sending)break;
                ByteBuffer b=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
                b.putInt(MAGIC);b.putInt(seq++);b.putLong(System.nanoTime());
                for(short sample:pcm)b.putShort(sample);
                txSocket.send(new DatagramPacket(data,data.length,destination,port));
                sent++;bytes+=data.length;
            }
        }catch(Exception e){txStatus="TX STOPPED: "+e.getMessage();}
        sending=false;
    }
    public synchronized void stopSender(){
        sending=false;
        if(record!=null){try{record.stop();record.release();}catch(Exception ignored){}record=null;}
        if(txSocket!=null){txSocket.close();txSocket=null;}
        if(sender!=null){sender.interrupt();sender=null;}
        txStatus="OFF";
    }
    private void releaseSender(){
        sending=false;
        if(record!=null){try{record.stop();record.release();}catch(Exception ignored){}record=null;}
        if(txSocket!=null){txSocket.close();txSocket=null;}
    }
    public synchronized String startReceiver(int port,int outputIdA,int outputIdB,int initialBufferMs){
        stopReceiver();
        if(port<1024||port>65535)return rxStatus="INVALID PORT";
        AudioDeviceInfo a=device(outputIdA,false),b=outputIdB<0?null:device(outputIdB,false);
        if(a==null||(outputIdB>=0&&b==null))return rxStatus="OUTPUT DEVICE NOT FOUND";
        if(b!=null&&a.getId()==b.getId())return rxStatus="SELECT DIFFERENT OUTPUTS";
        targetPackets=Math.max(4,Math.min(40,initialBufferMs/5));
        rxDeviceA=outputIdA;rxDeviceB=outputIdB;
        routeA=-1;routeB=-1;
        received=missing=late=underruns=malformed=skipped=0;
        synchronized(lock){packets.clear();queueDepth=0;}
        try{
            outputA=openTrack(a);
            if(b!=null)outputB=openTrack(b);
            rxSocket=new DatagramSocket(new InetSocketAddress("0.0.0.0",port));
            rxSocket.setSoTimeout(250);
            outputA.play();if(outputB!=null)outputB.play();
            try{Thread.sleep(100);}catch(InterruptedException ignored){}
            AudioDeviceInfo dA=outputA.getRoutedDevice(),dB=outputB==null?null:outputB.getRoutedDevice();
            routeA=dA==null?-1:dA.getId();routeB=dB==null?-1:dB.getId();
            if(routeA!=rxDeviceA||(b!=null&&(routeB!=rxDeviceB||routeB==routeA)))
                throw new IllegalStateException("Android ignored preferred route A="+routeA+" B="+routeB);
            receiving=true;rxStatus="RECEIVING · BUFFER "+targetPackets*5+"ms";
            listener=new Thread(this::listen,"MASTER-LAB-LAN-RX");listener.start();
            player=new Thread(this::play,"MASTER-LAB-LAN-PLAY");player.start();
        }catch(Exception ex){
            rxStatus="RX FAILED: "+ex.getMessage();releaseReceiver();
        }
        return rxStatus;
    }
    private void listen(){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        byte[] data=new byte[PACKET+64];DatagramPacket datagram=new DatagramPacket(data,data.length);
        int lastSeq=-1;
        try{
            while(receiving){
                try{datagram.setLength(data.length);rxSocket.receive(datagram);}
                catch(java.net.SocketTimeoutException ignored){continue;}
                if(datagram.getLength()!=PACKET){malformed++;continue;}
                ByteBuffer b=ByteBuffer.wrap(datagram.getData(),0,PACKET).order(ByteOrder.LITTLE_ENDIAN);
                if(b.getInt()!=MAGIC){malformed++;continue;}
                int seq=b.getInt();b.getLong();
                short[] pcm=new short[SAMPLES];
                for(int i=0;i<pcm.length;i++)pcm[i]=b.getShort();
                synchronized(lock){
                    if(lastSeq>=0&&seq<=lastSeq){late++;continue;}
                    if(lastSeq>=0&&seq>lastSeq+1)missing+=(long)seq-lastSeq-1;
                    lastSeq=seq;received++;
                    packets.put(seq,pcm);
                    while(packets.size()>Math.max(targetPackets*3,32)){packets.pollFirstEntry();skipped++;}
                    queueDepth=packets.size();lock.notifyAll();
                }
            }
        }catch(Exception ex){if(receiving)rxStatus="RX NETWORK ERROR: "+ex.getMessage();}
        receiving=false;
    }
    private void play(){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] silence=new short[SAMPLES],a=new short[SAMPLES],b=new short[SAMPLES];
        try{
            synchronized(lock){
                long deadline=System.currentTimeMillis()+3500;
                while(receiving&&packets.size()<targetPackets&&System.currentTimeMillis()<deadline)lock.wait(20);
            }
            while(receiving){
                short[] next=null;
                synchronized(lock){
                    if(!packets.isEmpty())next=packets.pollFirstEntry().getValue();
                    queueDepth=packets.size();
                }
                if(next==null){underruns++;next=silence;}
                apply(next,a,matrixA);
                if(outputA.write(a,0,a.length,AudioTrack.WRITE_BLOCKING)<0)throw new IllegalStateException("OUTPUT A WRITE FAILED");
                if(outputB!=null){
                    apply(next,b,matrixB);
                    if(outputB.write(b,0,b.length,AudioTrack.WRITE_BLOCKING)<0)throw new IllegalStateException("OUTPUT B WRITE FAILED");
                }
            }
        }catch(Exception ex){if(receiving)rxStatus="RX PLAYBACK ERROR: "+ex.getMessage();}
        receiving=false;
    }
    private static void apply(short[] src,short[] dst,float[] m){
        for(int i=0;i<src.length;i+=2){
            float l=src[i],r=src[i+1];
            dst[i]=clip(l*m[0]+r*m[1]);dst[i+1]=clip(l*m[2]+r*m[3]);
        }
    }
    public synchronized void stopReceiver(){
        receiving=false;
        if(rxSocket!=null){rxSocket.close();rxSocket=null;}
        synchronized(lock){lock.notifyAll();packets.clear();}
        if(listener!=null){listener.interrupt();listener=null;}
        if(player!=null){player.interrupt();player=null;}
        close(outputA);close(outputB);outputA=null;outputB=null;
        rxStatus="OFF";
    }
    private void releaseReceiver(){
        receiving=false;if(rxSocket!=null){rxSocket.close();rxSocket=null;}
        close(outputA);close(outputB);outputA=null;outputB=null;
    }
    public synchronized void shutdown(){stopSender();stopReceiver();}
    public String diagnostics(){
        JSONObject j=new JSONObject();
        try{
            j.put("tx",txStatus);j.put("rx",rxStatus);
            j.put("sending",sending);j.put("receiving",receiving);
            j.put("sent",sent);j.put("received",received);j.put("missing",missing);
            j.put("late",late);j.put("skipped",skipped);j.put("underruns",underruns);
            j.put("malformed",malformed);j.put("queuePackets",queueDepth);
            j.put("configuredBufferMs",targetPackets*5);
            j.put("inputId",txDevice);j.put("outA",routeA);j.put("outB",routeB);
            j.put("sampleRate",RATE);j.put("channels",CHANNELS);
        }catch(Exception ignored){}
        return j.toString();
    }
}
