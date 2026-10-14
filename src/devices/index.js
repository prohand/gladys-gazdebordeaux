// -----------------------------------------------------------------------------
// Device registry: one device per contract of the customer account.
//
// Unlike the template's fixed catalog, the devices come from the account
// (gas, electricity, sometimes several of each), so the registry is built
// from the contracts the last refresh read.
// -----------------------------------------------------------------------------

import { buildDevice, contractIds } from './contract.js';

/** The discovery payload: one device per contract. */
export function buildDiscoveredDevices(gladys, contracts) {
  return contracts.map((contract) =>
    buildDevice(gladys, contract, {
      ambiguous: contracts.some((other) => other !== contract && other.energy === contract.energy),
    }),
  );
}

/** The contract a device external_id belongs to, or undefined. */
export function findContract(gladys, contracts, externalId) {
  return contracts.find((contract) => contractIds(gladys, contract).device === externalId);
}

/** True when the user created the device in Gladys (Discovery tab). */
export function isCreated(gladys, externalId) {
  return (gladys.devices ?? []).some((device) => device.external_id === externalId);
}
