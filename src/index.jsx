import('./bootstrap').catch((error) => {
  // Keep bootstrap failures visible instead of rendering a blank remote.
  console.error('Direct Claims remote failed to bootstrap', error);
});
