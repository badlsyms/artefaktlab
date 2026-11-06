package cz.artefaktlab.masterlab;

import android.app.Activity;
import android.os.Bundle;
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
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int PICK_FILES = 1201;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        web.setBackgroundColor(0xff080f18);
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
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String u = request.getUrl().toString();
                return !u.startsWith("file:///android_asset/");
            }
            @Override public void onPageFinished(WebView v, String url) { installDownloadBridge(); }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }
    private void installDownloadBridge() {
        String js = "(function(){document.addEventListener('click',async function(ev){var a=ev.target.closest&&ev.target.closest('a[download]');if(!a||!a.href.startsWith('blob:'))return;ev.preventDefault();try{var blob=await fetch(a.href).then(r=>r.blob());var reader=new FileReader();reader.onload=function(){AndroidMasterLab.save(a.download||'masterlab-export',reader.result)};reader.readAsDataURL(blob)}catch(e){console.error(e)}},true)})();";
        web.evaluateJavascript(js, null);
    }
    public final class ExportBridge {
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
        if(fileCallback!=null) fileCallback.onReceiveValue(null);
        web.removeJavascriptInterface("AndroidMasterLab");
        web.destroy();
        super.onDestroy();
    }
}
