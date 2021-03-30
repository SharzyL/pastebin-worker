export const helpHTML = `
<!DOCTYPE html>
<body>

<h1>Yet Another Pastebin</h1>
<p>This is a pastebin deployed on Cloudflare workers, depending on its KV storage.
  It is designed to be easy to deploy, and friendly for CLI usage. </p>

<form enctype="multipart/form-data">
  <div>
    <input id="p" type="checkbox" name="p">
    <label for="p">Private paste</label>
    <input id="e" name='e' type='number' min='60'/>
    <label for="e">Expire in seconds (at least 60)</label>
  </div>
  <label>
    <textarea placeholder='Put your paste here' id="c" name='c' rows='20' style="width: 100%"></textarea>
  </label>
  <input type="submit" value="Submit" formaction="https://shz.al" formmethod="POST">
</form>

<h2>CLI Usage</h2>
<p> Upload a paste </p>
<pre><code>$ echo "make Cloudflare great again" | curl -F "c=@-" ${BASE_URL}
{
  "url": "${BASE_URL}qotL",
  "admin": "${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=",
  "isPrivate": false
}% </code> </pre>

<p>Fetch the paste</p>
<pre><code>$ curl ${BASE_URL}qotL
make Cloudflare great again </code></pre>

<p>Delete the paste</p>
<pre><code>$ curl -X DELETE ${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=
the paste will be deleted in seconds

$ curl ${BASE_URL}qotL
not found% </code></pre>

<p>Update the paste</p>
<pre><code>$ echo "make Cloudflare great again and again" | curl -F "c=@-" ${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=
{
  "url": "${BASE_URL}qotL",
  "admin": "${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=",
  "isPrivate": false
}% </code></pre>

<h2>Advanced Usage</h2>

<p>Fetch the paste with syntax highlighting</p>
<pre><code>$ curl ${BASE_URL}48wp?lang=makefile
</code></pre>

<p>Url redirect</p>
<pre><code>$ curl -L ${BASE_URL}u/i-p-
</code></pre>

<p>Let the paste expire in 120 seconds</p>
<pre><code>$ echo "make Cloudflare great again" | curl -F "c=@-" -F "e=120" ${BASE_URL}
{
  "url": "${BASE_URL}qotL",
  "admin": "${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=",
  "isPrivate": false,
  "expire": "120"
}% </code></pre>

<p>Create a paste with longer path name for better privacy</p>
<pre><code>$ echo "make Cloudflare great again" | curl -F "c=@-" -F "p=true" ${BASE_URL}
{
  "url": "${BASE_URL}HaK8PuBqrLi5woH0cbTBi7uN",
  "admin": "${BASE_URL}HaK8PuBqrLi5woH0cbTBi7uN_TWcWYDRL4SscGQ9P9n7tO7Vu6HU=",
  "isPrivate": true,
}% </code></pre>

<h2>About</h2>
<p>API design is inspired by <a href='https://fars.ee'>fars.ee</a></p>
<p>Source code and error report: <a href='https://github.com/SharzyL/pastebin-worker'>SharzyL/pastebin-worker</a> </p>
</body>
`