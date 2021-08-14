function copyTextFromInput(input) {
  if (input.constructor === String) {
    input = document.getElementById(input)
    button = input.parentNode.querySelector('button')
  }
  input.focus()
  input.select()
  try {
    document.execCommand('copy')
    button.textContent = 'Copied!'
  } catch (err) {
    alert('Failed to copy content')
  }
}

window.addEventListener('load', () => {
  const base_url = '{{BASE_URL}}'
  const deploy_date = new Date('{{DEPLOY_DATE}}')

  function getDateString(date) {
    console.log(date)
    const year = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hour = date.getHours().toString().padStart(2, '0')
    const minute = date.getMinutes().toString().padStart(2, '0')
    const second = date.getSeconds().toString().padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  }

  $('#deploy-date').text(getDateString(deploy_date))

  function isAdminUrlLegal(url) {
    try {
      url = new URL(url)
      return url.origin === base_url && url.pathname.indexOf(':') >= 0
    } catch (e) {
      if (e instanceof TypeError) {
        return false
      } else {
        throw e
      }
    }
  }

  const formatSize = (size) => {
    if (!size) return '0'
    if (size < 1024) {
      return `${size} Bytes`
    } else if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(2)} KB`
    } else if (size < 1024 * 1024 * 1024) {
      return `${(size / 1024 / 1024).toFixed(2)} MB`
    } else {
      return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
    }
  }

// monitor input changes and enable/disable submit button
  let urlType = 'short', inputType = 'edit', expiration = '', passwd = ''
  let customName = '', adminUrl = '', file = null

  const NAME_REGEX = /^[a-zA-Z0-9+_\-\[\]*$=@,;/]{3,}$/
  const submitButton = $('#submit-button')
  const deleteButton = $('#delete-button')
  const pasteEditArea = $('#paste-textarea')

  function updateButtons() {
    const pasteNotEmpty = inputType === 'edit'
      ? pasteEditArea.prop('value').length > 0
      : file !== null
    const expirationNotShort = expiration.length === 0 || parseInt(expiration) >= 60
    const nameValid = urlType !== 'custom' || NAME_REGEX.test(customName)
    const adminUrlValid = urlType !== 'admin' || isAdminUrlLegal(adminUrl)

    if (pasteNotEmpty && expirationNotShort && nameValid && adminUrlValid) {
      submitButton.addClass('enabled')
      submitButton.removeProp('title')
    } else {
      submitButton.removeClass('enabled')
      if (!pasteNotEmpty) {
        submitButton.prop('title', 'Cannot upload empty paste')
      } else if (!expirationNotShort) {
        submitButton.prop('title', 'Expiration should be more than 60 seconds')
      } else if (!nameValid) {
        submitButton.prop('title', `The customized URL should satisfy regex ${NAME_REGEX}`)
      }
    }

    if (urlType === 'admin') {
      submitButton.text('Update')
      deleteButton.removeClass('hidden')
    } else {
      submitButton.text('Submit')
      deleteButton.addClass('hidden')
    }

    if (adminUrlValid) {
      deleteButton.addClass('enabled')
      submitButton.removeProp('title')
    } else {
      deleteButton.removeClass('enabled')
      submitButton.prop('title', `The admin URL should start with ${base_url} and contain a colon`)
      deleteButton.prop('title', `The admin URL should start with ${base_url} and contain a colon`)
    }
  }

  updateButtons()

  function updateTabBar() {
    if (inputType === 'file') {
      $('#paste-tab-edit').removeClass('enabled')
      $('#paste-tab-file').addClass('enabled')
      $('#paste-file-show').addClass('enabled')
      $('#paste-edit').removeClass('enabled')
    } else {
      $('#paste-tab-file').removeClass('enabled')
      $('#paste-tab-edit').addClass('enabled')
      $('#paste-edit').addClass('enabled')
      $('#paste-file-show').removeClass('enabled')
    }
  }

  $('#paste-tab-file').on('input', event => {
    const files = event.target.files
    if (files.length === 0) return
    file = files[0]
    inputType = 'file'
    updateButtons()
    updateTabBar()
    const fileLine = $('#paste-file-line')
    fileLine.children('.file-name').text(file.name)
    fileLine.children('.file-size').text(formatSize(file.size))
  })

  $('#paste-tab-edit').on('click', () => {
    inputType = 'edit'
    updateButtons()
    updateTabBar()
  })

  pasteEditArea.on('input', updateButtons)

  $('#paste-expiration-input').on('input', event => {
    expiration = event.target.value
    updateButtons()
  })

  $('#paste-passwd-input').on('input', event => {
    passwd = event.target.value
  })

  $('input[name="url-type"]').on('input', event => {
    urlType = event.target.value
    updateButtons()
  })

  $('#paste-custom-url-input').on('input', event => {
    customName = event.target.value
    updateButtons()
  })

  $('#paste-admin-url-input').on('input', event => {
    adminUrl = event.target.value
    updateButtons()
  })

// submit the form
  submitButton.on('click', () => {
    if (submitButton.hasClass('enabled')) {
      if (urlType === 'admin') {
        putPaste()
      } else {
        postPaste()
      }
    }
  })

  deleteButton.on('click', () => {
    if (deleteButton.hasClass('enabled')) {
      deletePaste()
    }
  })

  function putPaste() {
    $('#paste-uploaded-panel').addClass('hidden')
    let fd = new FormData()
    if (inputType === 'file') {
      fd.append('c', file)
    } else {
      fd.append('c', pasteEditArea.prop('value'))
    }

    if (expiration.length > 0) fd.append('e', expiration)
    if (passwd.length > 0) fd.append('s', passwd)

    $.ajax({
      method: 'PUT',
      url: adminUrl,
      data: fd,
      processData: false,
      contentType: 'multipart/form-data',
      success: (data) => {
        renderUploaded(data)
      },
      error: handleError,
    })
  }

  function postPaste() {
    $('#paste-uploaded-panel').addClass('hidden')
    let fd = new FormData()
    if (inputType === 'file') {
      fd.append('c', file)
    } else {
      fd.append('c', pasteEditArea.prop('value'))
    }

    if (expiration.length > 0) fd.append('e', expiration)
    if (passwd.length > 0) fd.append('s', passwd)

    if (urlType === 'long') fd.append('p', 'true')
    if (urlType === 'custom') fd.append('n', customName)

    $.post({
      url: base_url,
      data: fd,
      processData: false,
      contentType: 'multipart/form-data',
      success: (data) => {
        renderUploaded(data)
      },
      error: handleError,
    })
  }

  function deletePaste() {
    let fd = new FormData()
    $.ajax({
      method: 'DELETE',
      url: adminUrl,
      data: fd,
      processData: false,
      success: () => {
        alert('Delete successfully')
      },
      error: handleError,
    })
  }

  function renderUploaded(uploaded) {
    $('#paste-uploaded-panel').removeClass('hidden')
    $('#uploaded-url').prop('value', uploaded.url)
    $('#uploaded-admin-url').prop('value', uploaded.admin)
    if (uploaded.expire) {
      $('#uploaded-expiration').prop('value', uploaded.expire)
    }
  }

  function handleError(error) {
    console.log(error)
    const status = error.status || ''
    let statusText = error.statusText === 'error' ? 'Unknown error' : error.statusText
    const responseText = error.responseText || ''
    alert(`Error ${status}: ${statusText}\n${responseText}\nView your console for more information`)
  }
})
