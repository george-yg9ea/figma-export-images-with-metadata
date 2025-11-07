# Debugging Guide

## How to View Console Logs

### Main Thread (code.ts) Console
1. In Figma, open the plugin
2. Go to **Plugins → Development → Open Console** (or press `Cmd+Option+I` on Mac / `Ctrl+Shift+I` on Windows)
3. This shows logs from the main plugin thread (code.ts)
4. Look for messages prefixed with `[Code]`

### UI Thread (ui.ts) Console
1. Right-click on the plugin UI window
2. Select **Inspect** (or **Inspect Element**)
3. This opens the browser DevTools for the UI
4. Go to the **Console** tab
5. Look for messages prefixed with `[UI]`

## What to Check

1. **Plugin loads**: You should see `[Code] Plugin starting, showing UI`
2. **UI loads**: You should see `[UI] DOM loaded, setting up event listeners`
3. **Button clicks**: You should see `[UI] Export JPEG button clicked` or `[UI] Export AVIF button clicked`
4. **Messages received**: You should see `[Code] Received message:` and `[UI] Received message:`

## Common Issues

- **No logs at all**: The plugin might not be loading. Check that you've rebuilt (`npm run build`) and re-imported the manifest.
- **UI logs missing**: The UI script might not be loading. Check the Network tab in UI DevTools to see if `ui.js` loads.
- **Messages not received**: Check that both threads are logging - if one side sends but the other doesn't receive, there's a communication issue.


