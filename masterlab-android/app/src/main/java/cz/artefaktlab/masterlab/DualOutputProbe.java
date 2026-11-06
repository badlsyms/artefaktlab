package cz.artefaktlab.masterlab;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Process;
import org.json.JSONObject;

public final class DualOutputProbe {
  private final AudioManager manager;
  private final Object lock=new Object();
  private volatile boolean active=false;
  private volatile String status="IDLE";
  private volatile int requestedA=-1,requestedB=-1,actualA=-1,actualB=-1;
  private AudioTrack trackA,trackB;
  private Thread worker;
  private static final int RATE=48000;
  DualOutputProbe(Activity activity){manager=(AudioManager)activity.getSystemService(Activity.AUDIO_SERVICE);}
  private AudioDeviceInfo output(int id){
    if(manager==null)return null;
    for(AudioDeviceInfo d:manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS))if(d.isSink()&&d.getId()==id)return d;
    return null;
  }
  private AudioTrack create(AudioDeviceInfo device){
    AudioFormat f=new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
    int min=AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_STEREO,AudioFormat.ENCODING_PCM_16BIT);
    if(min<=0)throw new IllegalStateException("Stereo 48k unsupported");
    AudioTrack t=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
      .setAudioFormat(f).setBufferSizeInBytes(Math.max(4096,min)).setTransferMode(AudioTrack.MODE_STREAM).build();
    if(t.getState()!=AudioTrack.STATE_INITIALIZED){t.release();throw new IllegalStateException("AudioTrack initialization failed");}
    if(!t.setPreferredDevice(device)){t.release();throw new IllegalStateException("Android rejected output preference");}
    return t;
  }
  public String begin(int idA,int idB){
    if(idA==idB)return "SELECT TWO DISTINCT OUTPUTS";
    stop();
    AudioDeviceInfo a=output(idA),b=output(idB);
    if(a==null||b==null)return "OUTPUT MISSING";
    synchronized(lock){
      requestedA=idA;requestedB=idB;actualA=-1;actualB=-1;active=true;status="STARTING";
      worker=new Thread(()->test(a,b),"MasterLab-DualOutputs");
      worker.start();
    }
    return "STARTING · INDEPENDENT ROUTING NOT YET VERIFIED";
  }
  private void test(AudioDeviceInfo a,AudioDeviceInfo b){
    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
    AudioTrack ta=null,tb=null;
    try{
      ta=create(a);tb=create(b);
      synchronized(lock){if(!active)return;trackA=ta;trackB=tb;}
      ta.play();tb.play();
      try{Thread.sleep(150);}catch(InterruptedException ignored){}
      AudioDeviceInfo ra=ta.getRoutedDevice(),rb=tb.getRoutedDevice();
      actualA=ra==null?-1:ra.getId();actualB=rb==null?-1:rb.getId();
      if(actualA!=requestedA||actualB!=requestedB||actualA==actualB){
        status="NOT INDEPENDENT · A "+actualA+" / B "+actualB;return;
      }
      status="TWO OUTPUT ROUTES VERIFIED · TESTING";
      short[] bufA=new short[960],bufB=new short[960];int frames=0,total=RATE*2;
      while(active&&frames<total){
        for(int i=0;i<480;i++){
          int sample=frames+i;
          double fade=Math.max(0,Math.min(1,Math.min(sample/(RATE*.05),(total-sample)/(RATE*.15))));
          short va=(short)(Math.sin(2*Math.PI*440*sample/RATE)*2000*fade);
          short vb=(short)(Math.sin(2*Math.PI*660*sample/RATE)*2000*fade);
          bufA[i*2]=va;bufA[i*2+1]=va;bufB[i*2]=vb;bufB[i*2+1]=vb;
        }
        if(ta.write(bufA,0,bufA.length,AudioTrack.WRITE_BLOCKING)<0||tb.write(bufB,0,bufB.length,AudioTrack.WRITE_BLOCKING)<0)
          throw new IllegalStateException("Audio write failed");
        frames+=480;
      }
      if(active)status="VERIFIED · BOTH OUTPUTS PLAYED";
    }catch(Exception e){status="FAILED: "+e.getMessage();}
    finally{
      active=false;
      synchronized(lock){if(trackA==ta)trackA=null;if(trackB==tb)trackB=null;}
      close(ta);close(tb);
    }
  }
  private void close(AudioTrack t){if(t==null)return;try{t.pause();t.flush();t.release();}catch(Exception ignored){}}
  public void stop(){
    Thread old;
    AudioTrack ta,tb;
    synchronized(lock){active=false;old=worker;worker=null;ta=trackA;tb=trackB;trackA=null;trackB=null;}
    if(old!=null)old.interrupt();
    close(ta);close(tb);
    status="IDLE";
  }
  public String status(){
    JSONObject j=new JSONObject();
    try{j.put("status",status);j.put("active",active);j.put("requestedA",requestedA);j.put("requestedB",requestedB);j.put("actualA",actualA);j.put("actualB",actualB);}catch(Exception ignored){}
    return j.toString();
  }
}
