// Habitat fork: announce the status line without announcing every interactive row.
const HabitatSurface = (() => {
  function line(key, retry, values) {
    const node = document.createElement('div');
    node.className = 'surface-state';
    node.setAttribute('role', retry ? 'alert' : 'status');
    node.textContent = t(key, values);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-sm';
      button.textContent = t('history.retry');
      button.addEventListener('click', event => {
        // A retry may replace the button before an outside-click listener sees it.
        event.stopPropagation();
        retry();
      });
      node.appendChild(button);
    }
    return node;
  }

  // These socket reads send a separate event, without an acknowledgement or request ID.
  // Replacing the pending line on success, navigation or retry invalidates its deadline.
  function wait(host, errorKey, retry, socket) {
    if (!host) return;
    const pending = line('thread_list.loading');
    pending.dataset.surface = 'loading';
    host.replaceChildren(pending);
    const fail = () => {
      if (pending.parentElement !== host) return;
      const error = line(errorKey, retry);
      error.dataset.surface = 'failed';
      host.replaceChildren(error);
    };
    if (socket?.connected === false) fail();
    else setTimeout(fail, 10000);
  }
  // Habitat fork: keep the deadline through the response body, including on older WebViews.
  function deadline(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  }
  // Habitat fork: each tag picker keeps its last answer while the next query is outstanding.
  function tagQuery(list) {
    const request = {};
    list._tagRequest = request;
    if (!list.firstChild || list.querySelector('[role="alert"]')) {
      const loading = line('thread_list.loading');
      loading.dataset.surface = 'loading';
      list.replaceChildren(loading);
    }
    return (err, response, retry) => {
      if (list._tagRequest !== request) return false;
      if (!err && response && !response.error) return true;
      if (response?.error === 'rate_limited') {
        if (list.firstChild?.dataset?.surface === 'loading') {
          list.replaceChildren(line('header.search_rate_limited', retry));
        }
      } else {
        list.replaceChildren(line('surface.tags_failed', retry));
      }
      return false;
    };
  }
  return { line, wait, deadline, tagQuery };
})();
