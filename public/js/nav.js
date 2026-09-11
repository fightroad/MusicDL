const viewSearch = document.getElementById('viewSearch')
const viewSources = document.getElementById('viewSources')
const viewDownloads = document.getElementById('viewDownloads')
const navLinks = document.querySelectorAll('[data-view]')

function showView(name) {
  const view =
    name === 'sources' ? 'sources' : name === 'downloads' ? 'downloads' : 'search'
  viewSearch.hidden = view !== 'search'
  viewSources.hidden = view !== 'sources'
  viewDownloads.hidden = view !== 'downloads'
  document.body.classList.toggle('page-sources-active', view === 'sources')
  document.body.classList.toggle('page-downloads-active', view === 'downloads')

  navLinks.forEach((el) => {
    if (el.classList.contains('brand')) return
    el.classList.toggle('active', el.dataset.view === view)
  })

  const hash =
    view === 'sources' ? '#sources' : view === 'downloads' ? '#downloads' : '#search'
  if (location.hash !== hash) {
    history.replaceState(null, '', hash)
  }

  if (view === 'sources' && typeof window.refreshSourceList === 'function') {
    window.refreshSourceList()
  }
  if (view === 'downloads' && typeof window.refreshDownloadList === 'function') {
    window.refreshDownloadList()
  }
  if (view === 'search' && typeof window.reloadSearchSources === 'function') {
    window.reloadSearchSources()
  }
}

function viewFromLocation() {
  if (location.pathname === '/sources' || location.hash === '#sources') return 'sources'
  if (location.pathname === '/downloads' || location.hash === '#downloads') return 'downloads'
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
