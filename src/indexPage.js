export const helpHTML = `
<!DOCTYPE html>
<head>
  <meta charset='UTF-8'>
  <title>Yet another pastebin</title>
  <link rel="stylesheet" href="https://pages.github.com/assets/css/style.css"/>
  <link rel="icon" href="${FAVICON_URL}" type="image/png"/>
</head>
<body>
<div class="container-lg px-3 my-5 markdown-body">
<h1>Yet Another Pastebin</h1>
<p>This is a pastebin deployed on Cloudflare workers, depending on Cloudflare KV storage. </p>
<p><b>How to use</b>: paste any text here, and you can share it with a super short URL. </p>
<p><b>Philosophy</b>: effortless deployment, friendly CLI usage, rich functionality. </p>

<form enctype="multipart/form-data">
  <label>
    <textarea placeholder='Put your paste here' id="c" name='c' rows='20' style="width: 100%; font-family: monospace; font-size: 14px"></textarea>
  </label>
  <div style="display: flex; align-items: center">
    <div style="flex: 1">
      <input id="p" type="checkbox" name="p"/>
      <label for="p"> Private paste</label>
    </div>
    <input id="n" placeholder='Custom Name' name='n' type='text' style="width: 10em"/>
    <input id="e" placeholder='Expire in (secs)' name='e' type='number' min='60' style="width: 10em"/>
    <input name='h' value="true" style="display: none"/>
    <input type="submit" value="Submit" formaction="/" formmethod="POST"/>
  </div>
</form>

<h2>CLI Usage</h2>
<p> Upload a paste </p>
<pre><code>$ echo "make Cloudflare great again" | curl -Fc=@- ${BASE_URL}
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
<pre><code>$ echo "make Cloudflare great again and again" | curl -X POST -Fc=@- ${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=
{
  "url": "${BASE_URL}qotL",
  "admin": "${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=",
  "isPrivate": false
}% </code></pre>

<h2>Advanced Usage</h2>

<p>Fetch the paste with syntax highlighting. Refer to <a href="https://prismjs.com/#supported-languages">Prism</a> for language support information</p>
<pre><code>$ curl ${BASE_URL}48wp?lang=makefile
</code></pre>

<p> Upload paste with custom address (address must satisfy regex <code>~[a-zA-Z0-9+-=@]{3,}</code>)</p>
<pre><code>$ echo "make Cloudflare great again" | curl -Fc=@- -Fn=cloudflare ${BASE_URL}
{
  "url": "${BASE_URL}~cloudflare",
  "admin": "${BASE_URL}~cloudflare_vOcQS1yv0v1UmIJOnfEKMAElCqE=",
  "isPrivate": false
}</code></pre>

<p>Url 301 redirect</p>
<pre><code>$ curl -fc=https://github.com/SharzyL/pastebin-worker/ ${BASE_URL}
$ firefox ${BASE_URL}u/i-p-
</code></pre>

<p>Specify mimetype</p>
<pre><code>$ curl ${BASE_URL}qotL.json -v | grep 'content-type'
...
< content-type: application/json;charset=UTF-8
...

$ curl '${BASE_URL}qotL?mime=application/json' -v
...
< content-type: application/json;charset=UTF-8
...</code></pre>

<p>Let the paste expire in 120 seconds</p>
<pre><code>$ echo "make Cloudflare great again" | curl -Fc=@- -Fe=120 ${BASE_URL}
{
  "url": "${BASE_URL}qotL",
  "admin": "${BASE_URL}qotL_yNm3PTBA3+X1jjhdClJ6zyVMkfA=",
  "isPrivate": false,
  "expire": "120"
}%

$ sleep 120; curl ${BASE_URL}qotL
not found%</code></pre>

<p>Create a paste with longer path name for better privacy</p>
<pre><code>$ echo "make Cloudflare great again" | curl -Fc=@- -Fp=true ${BASE_URL}
{
  "url": "${BASE_URL}HaK8PuBqrLi5woH0cbTBi7uN",
  "admin": "${BASE_URL}HaK8PuBqrLi5woH0cbTBi7uN_TWcWYDRL4SscGQ9P9n7tO7Vu6HU=",
  "isPrivate": true,
}% </code></pre>

<h2>About</h2>
<p>API design is inspired by <a href='https://fars.ee'>fars.ee</a></p>
<p>Source code and error report: <a href='https://github.com/SharzyL/pastebin-worker'>SharzyL/pastebin-worker</a> </p>
</div>
</body>
`
