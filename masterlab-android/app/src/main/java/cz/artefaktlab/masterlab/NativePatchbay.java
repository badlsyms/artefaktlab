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
import android.os.Build;
import android.os.Process;
import org.json.JSONObject;

public final class NativePatchbay {
    private final Activity activity;
    private final AudioManager manager;
    private volatile boolean running;
    private volatile String status="OFF";
    private volatile int actualInput=-1,actualOutput=-1;
    private volatile float[] matrix={1f,0f,0f,1f};
    private AudioRecord input;
    private AudioTrack output;
    private Thread worker;
    private static final int RATE=48000;
    private static final int INPUT_FORMAT=AudioFormat.CHANNEL_IN_STEREO;
    private static final int OUTPUT_FORMAT=AudioFormat.CHANNEL_OUT_STEREO;

    public NativePatchbay(Activity activity){
        this.activity=activity;
        manager=(AudioManager)activity.getSystemService(Activity.AUDIO_SERVICE);
    }
    private AudioDeviceInfo find(int id, boolean source){
        if(manager==null)return null;
        for(AudioDeviceInfo d:manager.getDevices(source?AudioManager.GET_DEVICES_INPUTS:AudioManager.GET_DEVICES_OUTPUTS)){
            if(d.getId()==id && (source?d.isSource():d.isSink()))return d;
        }
        return null;
    }
    public synchronized String start(int inId,int outId){
        stop();
        if(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            status="RECORD_AUDIO PERMISSION REQUIRED";return status;
        }
        AudioDeviceInfo src=find(inId,true),dst=find(outId,false);
        if(src==null || dst==null){status="SELECT VALID INPUT AND OUTPUT";return status;}
        try{
            final int inputMin=AudioRecord.getMinBufferSize(RATE,INPUT_FORMAT,AudioFormat.ENCODING_PCM_16BIT);
            final int outputMin=AudioTrack.getMinBufferSize(RATE,OUTPUT_FORMAT,AudioFormat.ENCODING_PCM_16BIT);
            if(inputMin<=0||outputMin<=0){status="48 KHZ STEREO NOT SUPPORTED";return status;}
            int inputBytes=Math.max(inputMin*2,4096),outputBytes=Math.max(outputMin*2,4096);
            AudioFormat captureFormat=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(INPUT_FORMAT).build();
            AudioFormat renderFormat=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(OUTPUT_FORMAT).build();
            input=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.UNPROCESSED).setAudioFormat(captureFormat).setBufferSizeInBytes(inputBytes).build();
            output=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(renderFormat).setBufferSizeInBytes(outputBytes).setTransferMode(AudioTrack.MODE_STREAM).build();
            if(input.getState()!=AudioRecord.STATE_INITIALIZED || output.getState()!=AudioTrack.STATE_INITIALIZED)throw new IllegalStateException("PCM init failed");
            if(!input.setPreferredDevice(src)||!output.setPreferredDevice(dst))throw new IllegalStateException("Device selection rejected");
            input.startRecording();output.play();
            AudioDeviceInfo actualIn=input.getRoutedDevice(),actualOut=output.getRoutedDevice();
            actualInput=actualIn==null?-1:actualIn.getId();
            actualOutput=actualOut==null?-1:actualOut.getId();
            if(actualInput!=inId || actualOutput!=outId)throw new IllegalStateException("Android routed to another device");
            running=true;status="ACTIVE 48K PCM16 STEREO";
            worker=new Thread(this::pump,"MasterLab-NativePatchbay");
            worker.start();
        }catch(Exception ex){
            status="START FAILED: "+ex.getMessage();stopResources();
        }
        return status;
    }
    private static short clip(float sample){
        return (short)Math.max(-32768,Math.min(32767,Math.round(sample)));
    }
    private void pump(){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] inputBuffer=new short[2048],outputBuffer=new short[2048];
        try{
            while(running){
                int count=input.read(inputBuffer,0,inputBuffer.length,AudioRecord.READ_BLOCKING);
                if(count<0)throw new IllegalStateException("AudioRecord read "+count);
                float[] m=matrix;
                for(int i=0;i+1<count;i+=2){
                    float l=inputBuffer[i],r=inputBuffer[i+1];
                    outputBuffer[i]=clip(l*m[0]+r*m[1]);
                    outputBuffer[i+1]=clip(l*m[2]+r*m[3]);
                }
                int written=0;
                while(running && written<count){
                    int n=output.write(outputBuffer,written,count-written,AudioTrack.WRITE_BLOCKING);
                    if(n<=0)throw new IllegalStateException("AudioTrack write "+n);
                    written+=n;
                }
            }
        }catch(Exception ex){status="STREAM ERROR: "+ex.getMessage();}
        running=false;
    }
    public void setMatrix(float ll,float rl,float lr,float rr){
        matrix=new float[]{bound(ll),bound(rl),bound(lr),bound(rr)};
    }
    private static float bound(float v){return Float.isFinite(v)?Math.max(0f,Math.min(2f,v)):0f;}
    public synchronized void stop(){
        running=false;
        if(worker!=null){worker.interrupt();worker=null;}
        stopResources();
        if(!status.startsWith("START FAILED")&&!status.startsWith("STREAM ERROR"))status="OFF";
    }
    private void stopResources(){
        if(input!=null){try{input.stop();}catch(Exception ignored){}try{input.release();}catch(Exception ignored){}input=null;}
        if(output!=null){try{output.pause();output.flush();}catch(Exception ignored){}try{output.release();}catch(Exception ignored){}output=null;}
    }
    public String getStatus(){
        JSONObject result=new JSONObject();
        try{
            result.put("running",running);result.put("status",status);result.put("inputId",actualInput);result.put("outputId",actualOutput);
            result.put("rate",RATE);result.put("channelCount",2);
        }catch(Exception ignored){}
        return result.toString();
    }
}
