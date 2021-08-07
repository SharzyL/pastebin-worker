export function makeUploadedPage(created) {
  return `<!DOCTYPE html>
<head>
  <meta charset='UTF-8'>
  <title>Yet another pastebin</title>
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'/>
</head>
<body>
<script>
  function copyTextFromInput(input) {
    if (input.constructor === String) input = document.getElementById(input)
    input.focus();
    input.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      alert('Failed to copy content')
    }
  }
</script>
<div class='container-lg px-3 my-5 markdown-body'>
  <h1>You have successfully uploaded a paste</h1>
  <table>
    <tr>
      <td>
        <label for='url-bar'>URL</label>
      </td>
      <td>
        <input id='url-bar' type='text' readonly value='${created.url}'>
        <button onclick='copyTextFromInput("url-bar")'>Copy</button>
      </td>
    </tr>
    <tr>
      <td>
        <label for='admin-url-bar'>Admin URL</label>
      </td>
      <td>
        <input id='admin-url-bar' type='text' readonly value='${created.admin}'>
        <button onclick='copyTextFromInput("admin-url-bar")'>Copy</button>
      </td>
    </tr>
    <tr>
      <td>Expiration</td>
      <td>${created.expire}</td>
    </tr>
  </table>
</div>
</body>
`
}
