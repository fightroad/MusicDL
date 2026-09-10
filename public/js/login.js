const form = document.getElementById('loginForm')
const passwordInput = document.getElementById('password')
const statusEl = document.getElementById('loginStatus')

function setStatus(message, isError = false) {
  if (!message) {
    statusEl.hidden = true
    statusEl.textContent = ''
    statusEl.classList.remove('is-error')
    return
  }
  statusEl.hidden = false
  statusEl.textContent = message
  statusEl.classList.toggle('is-error', isError)
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const password = passwordInput.value
  if (!password) {
    setStatus('请输入密码', true)
    return
  }
  setStatus('登录中…')
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      let msg = '登录失败'
      try {
        const data = await res.json()
        msg = data.detail || msg
      } catch (_) {}
      setStatus(msg, true)
      return
    }
    location.href = '/'
  } catch (err) {
    setStatus(err.message || '网络错误', true)
  }
})
