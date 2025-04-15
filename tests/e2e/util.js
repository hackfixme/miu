export const logError = (e) => {
  console.error({
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error?.toString(),
    stack: e.error?.stack
  });
}

export async function loadTestFrame(path) {
  document.body.style = 'margin: 0; height: 100vh;';
  const iframe = document.createElement('iframe');
  iframe.style = 'width: 100%; height: 99%; border: none; overflow: hidden;';
  document.body.appendChild(iframe);

  const errors = [];

  // Initialize empty document
  iframe.contentDocument.write('<html><head></head><body></body></html>');

  // Setup console capture before loading content
  const methods = ['log', 'error', 'warn', 'info', 'debug'];
  methods.forEach(method => {
    iframe.contentWindow.console[method] = (...args) => {
      if (method === 'error') {
        errors.push(new Error(args.join(' ')));
      } else {
        console[method](...args);
      }
    };
  });
  iframe.contentWindow.addEventListener('error', (e) => errors.push(e));

  // Fetch and inject content
  const response = await fetch(path);
  const html = await response.text();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();

  // Wait for iframe to load
  await new Promise(resolve => {
    iframe.onload = resolve;
  });

  return {
    doc: iframe.contentDocument,
    errors
  };
}
