package cz.artefaktlab.masterlab;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Process;
import org.json.JSONObject;

public final class OutputProbe {
    private final AudioManager manager;
    private volatile String state="IDLE";
    private volatile boolean running=false;
    private Thread worker;
    private AudioTrack track;
    private volatile int deviceId=-1,routedId=-1;
    private static final int SAMPLE_RATE=48000;

    public OutputProbe(Activity a){manager=(AudioManager)a.getSystemService(Activity.AUDIO_SERVICE);}
    public synchronized String start(int id,int channel){
        stop();
        if(channel<0||channel>2){state="INVALID CHANNEL";return state;}
        AudioDeviceInfo device=null;
        if(manager!=null)for(AudioDeviceInfo d:manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)){
            if(d.getId()==id&&d.isSink()){device=d;break;}
        }
        if(device==null){state="DEVICE NOT FOUND";return state;}
        deviceId=id;
        running=true;state="STARTING";final AudioDeviceInfo target=device;
        worker=new Thread(()->play(target,channel),"MasterLab-OutputProbe");
        worker.start();return state;
    }
    private void play(AudioDeviceInfo device,int channel){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        AudioTrack local=null;
        try{
            AudioFormat format=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
            int min=AudioTrack.getMinBufferSize(SAMPLE_RATE,AudioFormat.CHANNEL_OUT_STEREO,AudioFormat.ENCODING_PCM_16BIT);
            if(min<=0)throw new IllegalStateException("Stereo 48k unsupported");
            local=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).setAudioFormat(format).setBufferSizeInBytes(Math.max(4096,min)).setTransferMode(AudioTrack.MODE_STREAM).build();
            track=local;
            if(local.getState()!=AudioTrack.STATE_INITIALIZED)throw new IllegalStateException("Track unavailable");
            if(!local.setPreferredDevice(device))throw new IllegalStateException("Device preference rejected");
            local.play();
            try{Thread.sleep(100);}catch(InterruptedException ignored){}
            AudioDeviceInfo routed=local.getRoutedDevice();routedId=routed==null?-1:routed.getId();
            if(routedId!=deviceId)throw new IllegalStateException("Android selected output "+routedId);
            state="ROUTE VERIFIED";
            short[] buf=new short[1024];int frames=0,total=SAMPLE_RATE*2;
            while(running&&frames<total){
                for(int i=0;i<buf.length/2;i++){
                    double fade=Math.min(1,Math.min(frames/(double)(SAMPLE_RATE/20),(total-frames)/(double)(SAMPLE_RATE/10)));
                    short v=(short)(Math.sin(2*Math.PI*440*frames/SAMPLE_RATE)*2200*Math.max(0,fade));
                    buf[2*i]=channel==1?0:v;buf[2*i+1]=channel==0?0:v;frames++;
                }
                int done=0;
                while(running&&done<buf.length){int n=local.write(buf,done,buf.length-done,AudioTrack.WRITE_BLOCKING);if(n<=0)throw new IllegalStateException("Write failed "+n);done+=n;}
            }
            if(running)state="TEST FINISHED · OUTPUT "+routedId;
        }catch(Exception e){state="TEST FAILED: "+e.getMessage();}
        finally{running=false;try{if(local!=null){local.pause();local.flush();local.release();}}catch(Exception ignored){}if(track==local)track=null;}
    }
    public synchronized void stop(){running=false;if(worker!=null){worker.interrupt();worker=null;}AudioTrack t=track;track=null;if(t!=null)try{t.pause();t.flush();t.release();}catch(Exception ignored){}state="IDLE";}
    public String status(){JSONObject o=new JSONObject();try{o.put("status",state);o.put("running",running);o.put("deviceId",deviceId);o.put("routedId",routedId);}catch(Exception ignored){}return o.toString();}
}
