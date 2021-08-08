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

<h2>Usage</h2>
<p>Please refer to <a href='https://github.com/SharzyL/pastebin-worker#usage'>Github</a> for documentation. </p>

<h2>Terms and Conditions</h2>
<p>Before starting using our service, please read <a href='https://shz.al/~tos.html'>Terms and Conditions</a> first. </p>
<h2>About</h2>
<p>API design is inspired by <a href='https://fars.ee'>fars.ee</a></p>
<p>Source code and error report: <a href='https://github.com/SharzyL/pastebin-worker'>SharzyL/pastebin-worker</a> </p>
<p>Contact: <a href='mailto:shz.al@sharzy.in'>shz.al@sharzy.in</a></p>
</div>
</body>
`
