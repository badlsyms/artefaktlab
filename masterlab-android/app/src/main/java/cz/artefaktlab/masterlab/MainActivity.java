package cz.artefaktlab.masterlab;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.content.Intent;
import android.content.ClipData;
import android.content.ContentValues;
import android.provider.MediaStore;
import android.os.Environment;
import android.net.Uri;
import android.webkit.*;
import android.view.WindowManager;
import android.widget.Toast;
import android.util.Base64;
import java.io.OutputStream;
import java.util.Locale;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.media.midi.MidiManager;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiDevice;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.Manifest;
import androidx.webkit.WebViewAssetLoader;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int PICK_FILES = 1201;
    private static final int PERMISSION_CAPTURE = 1202;
    private PermissionRequest pendingCapture;
    private MidiDevice activeMidiDevice;
    private MidiOutputPort activeMidiPort;
    private WebView web;
    private NativePatchbay nativePatchbay;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> fileCallback;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        assetLoader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        nativePatchbay = new NativePatchbay(this);
        web = new WebView(this);
        web.setBackgroundColor(0xff080f18);
        if (Build.VERSION.SDK_INT >= 35) {
            web.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(false);
        web.addJavascriptInterface(new ExportBridge(), "AndroidMasterLab");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean audioOnly = "appassets.androidplatform.net".equals(request.getOrigin().getHost());
                    for (String r : request.getResources()) {
                        if (!PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audioOnly = false;
                    }
                    if (!audioOnly || request.getResources().length != 1) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingCapture = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION_CAPTURE);
                    }
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE || true);
                startActivityForResult(Intent.createChooser(intent, "MASTER LAB · IMPORT"), PICK_FILES);
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String u = request.getUrl().toString();
                return !u.startsWith("https://appassets.androidplatform.net/assets/");
            }
            @Override public void onPageFinished(WebView v, String url) { installDownloadBridge(); }
        });
        setContentView(web);
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }
    private void installDownloadBridge() {
        String js = "(function(){document.addEventListener('click',async function(ev){var a=ev.target.closest&&ev.target.closest('a[download]');if(!a||!a.href.startsWith('blob:'))return;ev.preventDefault();try{var blob=await fetch(a.href).then(r=>r.blob());var reader=new FileReader();reader.onload=function(){AndroidMasterLab.save(a.download||'masterlab-export',reader.result)};reader.readAsDataURL(blob)}catch(e){console.error(e)}},true)})();";
        web.evaluateJavascript(js, null);
    }
    public final class ExportBridge {
        @JavascriptInterface public void requestPatchbayPermission(){
            runOnUiThread(() -> {if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},1203);});
        }
        @JavascriptInterface public String startPatchbay(int inputId,int outputId){
            if(nativePatchbay==null)return "NOT READY";
            return nativePatchbay.start(inputId,outputId);
        }
        @JavascriptInterface public void setPatchbayMatrix(float ll,float rl,float lr,float rr){
            if(nativePatchbay!=null)nativePatchbay.setMatrix(ll,rl,lr,rr);
        }
        @JavascriptInterface public String getPatchbayStatus(){
            return nativePatchbay==null?"{}":nativePatchbay.getStatus();
        }
        @JavascriptInterface public void stopPatchbay(){
            if(nativePatchbay!=null)nativePatchbay.stop();
        }
        @JavascriptInterface public String getMidiDevices() {
            JSONArray devices = new JSONArray();
            try {
                MidiManager manager = (MidiManager)getSystemService(MIDI_SERVICE);
                if(manager == null) return devices.toString();
                for(MidiDeviceInfo info : manager.getDevices()) {
                    JSONObject item = new JSONObject();
                    item.put("id", info.getId());
                    item.put("outputs", info.getOutputPortCount());
                    item.put("inputs", info.getInputPortCount());
                    String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME);
                    item.put("name", name != null ? name : "MIDI DEVICE");
                    devices.put(item);
                }
            } catch(Exception e) { return "[]"; }
            return devices.toString();
        }
        @JavascriptInterface public void connectMidiDevice(int id, int port) {
            runOnUiThread(() -> {
                try {
                    if(activeMidiPort != null){activeMidiPort.close();activeMidiPort=null;}
                    if(activeMidiDevice != null){activeMidiDevice.close();activeMidiDevice=null;}
                    MidiManager manager=(MidiManager)getSystemService(MIDI_SERVICE);
                    if(manager==null)return;
                    for(MidiDeviceInfo info : manager.getDevices()) {
                        if(info.getId()!=id || port<0 || port>=info.getOutputPortCount())continue;
                        manager.openDevice(info, device -> {
                            if(device==null)return;
                            activeMidiDevice=device;
                            activeMidiPort=device.openOutputPort(port);
                            if(activeMidiPort==null)return;
                            activeMidiPort.connect(new MidiReceiver(){
                                @Override public void onSend(byte[] data, int offset, int count, long timestamp) {
                                    JSONArray bytes=new JSONArray();
                                    for(int i=0;i<count;i++)bytes.put(data[offset+i]&255);
                                    final String script="window.dispatchEvent(new CustomEvent('masterlab-native-midi',{detail:"+bytes.toString()+"}));";
                                    runOnUiThread(()->{if(web!=null)web.evaluateJavascript(script,null);});
                                }
                            });
                        },new Handler(Looper.getMainLooper()));
                        break;
                    }
                } catch(Exception e) {
                    Toast.makeText(MainActivity.this,"MIDI: "+e.getMessage(),Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public String getUsbTopology() {
            JSONArray devices = new JSONArray();
            try {
                UsbManager manager = (UsbManager)getSystemService(USB_SERVICE);
                if (manager == null) return devices.toString();
                for (UsbDevice d : manager.getDeviceList().values()) {
                    JSONObject item = new JSONObject();
                    item.put("name", d.getProductName() != null ? d.getProductName() : "USB DEVICE");
                    item.put("vendorId", d.getVendorId());
                    item.put("productId", d.getProductId());
                    item.put("deviceClass", d.getDeviceClass());
                    JSONArray interfaces = new JSONArray();
                    for (int i = 0; i < d.getInterfaceCount(); i++) {
                        UsbInterface inf = d.getInterface(i);
                        JSONObject entry = new JSONObject();
                        entry.put("class", inf.getInterfaceClass());
                        entry.put("subclass", inf.getInterfaceSubclass());
                        entry.put("endpoints", inf.getEndpointCount());
                        interfaces.put(entry);
                    }
                    item.put("interfaces", interfaces);
                    devices.put(item);
                }
            } catch (Exception e) { return "[]"; }
            return devices.toString();
        }
        @JavascriptInterface public String getAudioDevices() {
            JSONArray devices = new JSONArray();
            try {
                AudioManager manager = (AudioManager)getSystemService(AUDIO_SERVICE);
                if (manager == null) return devices.toString();
                for (AudioDeviceInfo d : manager.getDevices(AudioManager.GET_DEVICES_ALL)) {
                    JSONObject item = new JSONObject();
                    item.put("name", d.getProductName() != null ? d.getProductName().toString() : "Audio Device");
                    item.put("type", d.getType());
                    item.put("id", d.getId());
                    item.put("input", d.isSource());
                    item.put("output", d.isSink());
                    item.put("address", d.getAddress());
                    int[] counts = d.getChannelCounts();
                    JSONArray countArray = new JSONArray();
                    for (int count : counts) countArray.put(count);
                    item.put("channelCounts", countArray);
                    int[] rates = d.getSampleRates();
                    JSONArray rateArray = new JSONArray();
                    for (int rate : rates) rateArray.put(rate);
                    item.put("sampleRates", rateArray);
                    devices.put(item);
                }
            } catch (Exception e) {
                return "[]";
            }
            return devices.toString();
        }
        @JavascriptInterface public void openBluetoothSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Bluetooth settings unavailable", Toast.LENGTH_SHORT).show(); }
            });
        }
        @JavascriptInterface public void openSoundSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Sound settings unavailable", Toast.LENGTH_SHORT).show(); }
            });
        }
        @JavascriptInterface public void save(String name, String dataUrl) {
            new Thread(() -> {
                try {
                    int comma = dataUrl.indexOf(',');
                    if (comma < 0) throw new IllegalArgumentException("Invalid export");
                    byte[] bytes = Base64.decode(dataUrl.substring(comma+1), Base64.DEFAULT);
                    String safe = name.replaceAll("[^a-zA-Z0-9._-]", "_");
                    if (safe.isEmpty()) safe = "masterlab-export.bin";
                    String ext = safe.toLowerCase(Locale.ROOT);
                    String mime = ext.endsWith(".wav") ? "audio/wav" :
                          ext.endsWith(".webm") ? "video/webm" :
                          ext.endsWith(".ogg") ? "audio/ogg" :
                          ext.endsWith(".m4a") ? "audio/mp4" :
                          ext.endsWith(".mp4") ? "video/mp4" :
                          ext.endsWith(".json") ? "application/json" : "application/octet-stream";
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MASTER_LAB");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if(uri == null) throw new IllegalStateException("Cannot create output");
                    try(OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if(out == null) throw new IllegalStateException("No output stream");
                        out.write(bytes);
                    }
                    runOnUiThread(() -> Toast.makeText(MainActivity.this,"MASTER LAB · Uloženo",Toast.LENGTH_SHORT).show());
                } catch(Exception ex) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this,"Export: "+ex.getMessage(),Toast.LENGTH_LONG).show());
                }
            }).start();
        }
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == PERMISSION_CAPTURE && pendingCapture != null) {
            PermissionRequest req = pendingCapture;
            pendingCapture = null;
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else req.deny();
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if(request != PICK_FILES || fileCallback == null) return;
        Uri[] uris = null;
        if(result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if(clip != null) {
                int n = clip.getItemCount();
                uris = new Uri[n];
                for(int i=0;i<n;i++) uris[i]=clip.getItemAt(i).getUri();
            } else if (data.getData()!=null) uris = new Uri[]{data.getData()};
        }
        fileCallback.onReceiveValue(uris);
        fileCallback=null;
    }
    @Override public void onBackPressed() {
        if(web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if(nativePatchbay!=null)nativePatchbay.stop();
        if(pendingCapture!=null){pendingCapture.deny();pendingCapture=null;}
        try{if(activeMidiPort!=null)activeMidiPort.close();if(activeMidiDevice!=null)activeMidiDevice.close();}catch(Exception ignored){}
        if(fileCallback!=null) fileCallback.onReceiveValue(null);
        web.removeJavascriptInterface("AndroidMasterLab");
        web.destroy();
        super.onDestroy();
    }
}
