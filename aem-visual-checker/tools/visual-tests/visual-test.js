// initialize visual test

function isVtestMode() {
  // check if the url contains vtest query param
  return window.parent?.window?.location?.search?.includes('vtest');
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch('http://localhost:3001/api/health');
    return response.ok;
  } catch (error) {
    console.error('Server not running:', error);
    return false;
  }
}

async function initializeVisualTest() {
  // Remove existing elements if they exist

  if (document.body.classList.contains('sidekick-library')) {
    const themeRoot = window.parent?.window?.document?.querySelector('sidekick-library')?.shadowRoot.querySelector('sp-theme');
    if (isVtestMode()) {
      console.log('in vtest mode');
      document.body.classList.add('vtest');
      themeRoot.querySelector('main').style.height = 'auto';
      themeRoot.querySelector('library-header')?.remove();
      themeRoot.querySelector('sp-divider')?.remove();
      themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('.menu').style.display = 'none';
      themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('.action-bar').style.display = 'none';
      themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('.frame-view').style.width = '100%';
      themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('.details-container').style.display = 'none';
      themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('.view').style.height = '100vh';
    }

    // Check if server is running and show the status
    const actionGroup = themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('sp-action-group');

    // Ensure action group has proper flex layout
    actionGroup.style.display = 'flex';
    actionGroup.style.alignItems = 'center';
    actionGroup.style.justifyContent = 'flex-start';

    // Create and show loader using Spectrum component
    const loader = document.createElement('sp-progress-circle');
    loader.setAttribute('data-vtest-loader', '');
    loader.setAttribute('label', 'Loading content');
    loader.setAttribute('indeterminate', '');
    loader.setAttribute('size', 's');
    loader.style.margin = '0 8px';
    if (!actionGroup.querySelector('[data-vtest-loader]')) {
      actionGroup.appendChild(loader);
    }

    // Create info icon with tooltip for server status
    const infoIconWrapper = document.createElement('span');
    infoIconWrapper.setAttribute('data-test-status-icon', '');
    infoIconWrapper.style.display = 'inline-flex';
    infoIconWrapper.style.alignItems = 'center';
    infoIconWrapper.style.position = 'relative';
    infoIconWrapper.style.margin = '0 8px';

    // SVG info icon
    const infoIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    infoIcon.setAttribute('width', '24');
    infoIcon.setAttribute('height', '24');
    infoIcon.setAttribute('viewBox', '0 0 24 24');
    infoIcon.style.verticalAlign = 'middle';
    infoIcon.style.cursor = 'pointer';

    const isServerRunning = await checkServer();
    const iconColor = isServerRunning ? 'green' : 'red';
    infoIcon.innerHTML = `
      <circle cx="12" cy="12" r="10" fill="${iconColor}" opacity="0.15"/>
      <circle cx="12" cy="12" r="9" stroke="${iconColor}" stroke-width="2" fill="none"/>
      <text x="12" y="16" text-anchor="middle" font-size="12" font-family="Arial" fill="${iconColor}">i</text>
    `;

    // Tooltip
    const tooltip = document.createElement('span');
    tooltip.textContent = isServerRunning ? 'Test Server is running' : 'Server is not running';
    tooltip.style.visibility = 'hidden';
    tooltip.style.background = '#333';
    tooltip.style.color = '#fff';
    tooltip.style.textAlign = 'center';
    tooltip.style.borderRadius = '4px';
    tooltip.style.padding = '6px 12px';
    tooltip.style.position = 'absolute';
    tooltip.style.zIndex = '1000';
    tooltip.style.top = 'calc(100% + 5px)';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translateX(-50%)';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.fontSize = '13px';
    tooltip.style.fontWeight = 'normal';
    tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    tooltip.style.opacity = '0';
    tooltip.style.transition = 'opacity 0.2s';
    tooltip.style.pointerEvents = 'none';

    // Show/hide tooltip on hover
    infoIconWrapper.addEventListener('mouseenter', () => {
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
      tooltip.style.pointerEvents = 'auto';
    });
    infoIconWrapper.addEventListener('mouseleave', () => {
      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = '0';
      tooltip.style.pointerEvents = 'none';
    });

    infoIconWrapper.appendChild(infoIcon);
    infoIconWrapper.appendChild(tooltip);
    actionGroup.append(infoIconWrapper);

    const vtestButton = document.createElement('button');
    vtestButton.setAttribute('data-vtest-button', '');
    vtestButton.style.minWidth = '100px';
    vtestButton.style.backgroundColor = '#0265dc';
    vtestButton.style.color = '#fff';
    vtestButton.style.border = 'none';
    vtestButton.style.borderRadius = '15px';
    vtestButton.style.padding = '8px 16px';
    vtestButton.style.cursor = 'pointer';
    vtestButton.style.fontSize = '14px';
    vtestButton.style.fontWeight = 'bold';
    vtestButton.style.display = 'inline-flex';
    vtestButton.style.alignItems = 'center';
    vtestButton.style.justifyContent = 'center';
    vtestButton.style.flexShrink = '0';
    vtestButton.style.marginLeft = '0';
    vtestButton.innerHTML = 'Run Test';

    // Disable button if server is not running
    if (!isServerRunning) {
      vtestButton.disabled = true;
      vtestButton.style.backgroundColor = '#ccc';
      vtestButton.style.cursor = 'not-allowed';
      vtestButton.title = 'Server is not running';
    }

    vtestButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Set loading state
      vtestButton.disabled = true;
      vtestButton.style.backgroundColor = '#ccc';
      vtestButton.style.cursor = 'not-allowed';
      vtestButton.innerHTML = 'Running...';

      // componentName is the last part of the path after split by /
      const componentName = window.parent?.window?.location?.search?.split('path=')[1]?.split('&')[0]?.split('/')?.pop();
      console.log(componentName, 'componentName');

      // Create modal outside try-catch so it's available for both success and error cases
      const modal = document.createElement('dialog');
      modal.style.padding = '20px';
      modal.style.borderRadius = '8px';
      modal.style.border = '1px solid #ccc';
      modal.style.maxWidth = '90vw';
      modal.style.maxHeight = '90vh';
      modal.style.width = '90vw';
      modal.style.height = '90vh';
      modal.style.display = 'flex';
      modal.style.flexDirection = 'column';

      try {
        const response = await fetch('http://localhost:3001/api/run-visual-test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: 'test:visual:block',
            component: componentName,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to run visual test');
        }
        console.log(data.output, 'Test completed');
      } catch (error) {
        console.error(error, 'Test failed');
      } finally {
        // Show modal with test results
        const reportTimestamp = new Date().getTime();
        modal.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h2 style="margin: 0; color: #d32f2f;">Test Results</h2>
            <button id="closeModal" style="
              padding: 8px 16px;
              background: #0265dc;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            ">Close</button>
          </div>
          <div style="flex: 1; overflow: hidden;">
            <iframe
              src="http://localhost:3001/playwright-report/index.html?t=${reportTimestamp}"
              style="
                width: 100%;
                height: 100%;
                border: 1px solid #ccc;
                border-radius: 4px;
                background-color: white;
              "
              title="Playwright Report"
              onerror="this.srcdoc='<div style="padding: 20px; text-align: center;"><h3>Report not available</h3><p>The test report could not be loaded. Please check if the tests completed successfully.</p></div>'"
            ></iframe>
          </div>
        `;
        document.body.appendChild(modal);
        modal.showModal();

        // Add event listener for close button
        modal.querySelector('#closeModal').addEventListener('click', () => {
          modal.close();
          modal.remove();
        });

        // Reset button state
        vtestButton.disabled = false;
        vtestButton.style.backgroundColor = '#0265dc';
        vtestButton.style.cursor = 'pointer';
        vtestButton.innerHTML = 'Run Test';
        console.log('Test completed');
      }
    });
    actionGroup.append(vtestButton);

    // Remove loader after elements are added
    const existingLoader = actionGroup.querySelector('[data-vtest-loader]');
    if (existingLoader) {
      existingLoader.remove();
    }
  }
}

// Listen for URL changes
let lastPath = '';
let isInitializing = false;

async function checkPathChange() {
  if (isInitializing) return;

  const currentPath = window.parent?.window?.location?.search || '';
  if (currentPath !== lastPath) {
    isInitializing = true;
    lastPath = currentPath;

    // remove the status element and vtest button
    // they are added in initializeVisualTest
    // so we need to remove them
    const themeRoot = window.parent?.window?.document?.querySelector('sidekick-library')?.shadowRoot.querySelector('sp-theme');
    const actionGroup = themeRoot.querySelector('plugin-renderer').shadowRoot.querySelector('sp-action-group');
    const infoIconWrapper = actionGroup.querySelector('span[data-test-status-icon]');
    if (infoIconWrapper) {
      infoIconWrapper.remove();
    }

    const vtestButton = actionGroup.querySelector('button[data-vtest-button]');
    if (vtestButton) {
      vtestButton.remove();
    }
    console.log('initializing visual test');
    await initializeVisualTest();
    isInitializing = false;
  }
}

// Listen for URL changes using popstate event
window.parent?.window?.addEventListener('popstate', checkPathChange);

// Initial check for path
checkPathChange();
