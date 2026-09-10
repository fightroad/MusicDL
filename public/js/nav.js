const viewSearch = document.getElementById('viewSearch')
const viewSources = document.getElementById('viewSources')
const navLinks = document.querySelectorAll('[data-view]')

function showView(name) {
  const view = name === 'sources' ? 'sources' : 'search'
  viewSearch.hidden = view !== 'search'
  viewSources.hidden = view !== 'sources'
  document.body.classList.toggle('page-sources-active', view === 'sources')

  navLinks.forEach((el) => {
    if (el.classList.contains('brand')) return
    el.classList.toggle('active', el.dataset.view === view)
  })

  const hash = view === 'sources' ? '#sources' : '#search'
  if (location.hash !== hash) {
    history.replaceState(null, '', hash)
  }

  if (view === 'sources' && typeof window.refreshSourceList === 'function') {
    window.refreshSourceList()
  }
  if (view === 'search' && typeof window.reloadSearchSources === 'function') {
    window.reloadSearchSources()
  }
}

function viewFromLocation() {
  if (location.pathname === '/sources' || location.hash === '#sources') return 'sources'
  return 'search'
}

navLinks.forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault()
    showView(el.dataset.view)
  })
})

window.addEventListener('hashchange', () => {
  showView(viewFromLocation())
})

showView(viewFromLocation())
