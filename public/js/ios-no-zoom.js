(() => {
  // iOS may ignore viewport user-scalable; block pinch + double-tap zoom.
  const block = (e) => e.preventDefault()
  document.addEventListener('gesturestart', block, { passive: false })

  let lastTouchEnd = 0
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) e.preventDefault()
      lastTouchEnd = now
    },
    { passive: false }
  )
})()
