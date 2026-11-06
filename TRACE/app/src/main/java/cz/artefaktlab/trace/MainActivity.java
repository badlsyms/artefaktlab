package cz.artefaktlab.trace;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.*;
import android.content.ActivityNotFoundException;
import java.io.*;
import org.json.JSONObject;
public class MainActivity extends Activity {
 WebView web; ValueCallback<Uri[]> chooser; final int PICK=314; Uri pending;
 public void onCreate(Bundle b) { super.onCreate(b); pending=getShared(getIntent());
 web=new WebView(this); setContentView(web); web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
 web.getSettings().setAllowFileAccessFromFileURLs(false);web.getSettings().setAllowUniversalAccessFromFileURLs(false);
 web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> c,FileChooserParams p){chooser=c;Intent i=new Intent(Intent.ACTION_GET_CONTENT);i.setType("image/*");i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(Intent.createChooser(i,"Vybrat obrázek"),PICK);return true;}});
 web.setWebViewClient(new WebViewClient(){@Override public void onPageFinished(WebView w,String s){if(pending!=null){Uri u=pending;pending=null;share(u);}}@Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){Uri u=r.getUrl();if("file".equals(u.getScheme()))return !u.toString().startsWith("file:///android_asset/");if("https".equals(u.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception e){}}return true;}});
 web.loadUrl("file:///android_asset/index.html"); }
 Uri getShared(Intent i){if(i==null||!Intent.ACTION_SEND.equals(i.getAction()))return null;try{Object u=i.getParcelableExtra(Intent.EXTRA_STREAM);return u instanceof Uri?(Uri)u:null;}catch(Exception e){return null;}}
 @Override protected void onNewIntent(Intent i){super.onNewIntent(i);setIntent(i);pending=getShared(i);if(web!=null)web.reload();}
 void share(Uri uri){try(InputStream in=getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n,len=0;while((n=in.read(b))!=-1){len+=n;if(len>12*1024*1024)return;out.write(b,0,n);}String mime=getContentResolver().getType(uri);if(mime==null||!mime.startsWith("image/"))mime="image/jpeg";String data="data:"+mime+";base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP);String js="fetch("+JSONObject.quote(data)+").then(x=>x.blob()).then(b=>loadImage(new File([b],'sdileno.jpg',{type:b.type})))";web.evaluateJavascript(js,null);}catch(Exception e){}}
 @Override protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(req==PICK&&chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);chooser=null;}}
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
}