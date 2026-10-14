// -----------------------------------------------------------------------------
// Entry point of the Gaz de Bordeaux integration for Gladys Assistant.
//
// Everything lives in src/integration.js (handlers) and below; this file only
// creates the SDK client, wires the shutdown and connects.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/integration.js';

const gladys = new GladysIntegration();
const integration = createIntegration(gladys);

// The SDK disconnects cleanly and exits with code 0 on SIGTERM/SIGINT.
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  integration.stop();
});

logger.info('Starting the Gaz de Bordeaux integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
