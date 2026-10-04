/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useCallback, useContext, useEffect, useState } from "react";
import {
    ClientEvent,
    type IMyDevice,
    type IPusher,
    LOCAL_NOTIFICATION_SETTINGS_PREFIX,
    type MatrixClient,
    type MatrixEvent,
    PUSHER_DEVICE_ID,
    PUSHER_ENABLED,
    type MatrixError,
    type LocalNotificationSettings,
} from "matrix-js-sdk/src/matrix";
import { type VerificationRequest, CryptoEvent } from "matrix-js-sdk/src/crypto-api";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../../languageHandler";
import { getDeviceClientInformation, pruneClientInformation } from "../../../../utils/device/clientInformation";
import { type DevicesDictionary, type ExtendedDevice, type ExtendedDeviceAppInfo } from "./types";
import { useEventEmitter } from "../../../../hooks/useEventEmitter";
import { isDeviceVerified } from "../../../../utils/device/isDeviceVerified";
import { SDKContext } from "../../../../contexts/SDKContext";

const parseDeviceExtendedInformation = (matrixClient: MatrixClient, device: IMyDevice): ExtendedDeviceAppInfo => {
    const { name, version, url } = getDeviceClientInformation(matrixClient, device.device_id);

    return {
        appName: name,
        appVersion: version,
        url,
    };
};

/**
 * Fetch extended details of the user's own devices
 *
 * @param matrixClient - Matrix Client
 * @returns A dictionary mapping from device ID to ExtendedDevice
 */
export async function fetchExtendedDeviceInformation(matrixClient: MatrixClient): Promise<DevicesDictionary> {
    const { devices } = await matrixClient.getDevices();

    // Together, not one after another: each asks the crypto layer, and a long list of sessions is that many
    // round trips in a row otherwise.
    const verified = await Promise.all(devices.map((device) => isDeviceVerified(matrixClient, device.device_id)));

    const devicesDict: DevicesDictionary = {};
    devices.forEach((device, index) => {
        devicesDict[device.device_id] = {
            ...device,
            isVerified: verified[index],
            ...parseDeviceExtendedInformation(matrixClient, device),
        };
    });
    return devicesDict;
}

interface OwnDevicesSnapshot {
    devices: DevicesDictionary;
    pushers: IPusher[];
    localNotificationSettings: Map<string, LocalNotificationSettings>;
    dehydratedDeviceId: string | undefined;
}

async function fetchSnapshot(matrixClient: MatrixClient): Promise<OwnDevicesSnapshot> {
    const ownUserId = matrixClient.getUserId()!;
    // Nothing here depends on anything else here: the three asks go out together.
    const [devices, { pushers }, userDevices] = await Promise.all([
        fetchExtendedDeviceInformation(matrixClient),
        matrixClient.getPushers(),
        matrixClient.getCrypto()?.getUserDeviceInfo([ownUserId]),
    ]);

    const localNotificationSettings = new Map<string, LocalNotificationSettings>();
    Object.keys(devices).forEach((deviceId) => {
        const eventType = `${LOCAL_NOTIFICATION_SETTINGS_PREFIX.name}.${deviceId}` as const;
        const event = matrixClient.getAccountData(eventType);
        if (event) {
            localNotificationSettings.set(deviceId, event.getContent());
        }
    });

    const dehydratedDeviceIds: string[] = [];
    for (const device of userDevices?.get(ownUserId)?.values() ?? []) {
        if (device.dehydrated) {
            dehydratedDeviceIds.push(device.deviceId);
        }
    }
    // If the user has exactly one device marked as dehydrated, we consider
    // that as the dehydrated device, and hide it as a normal device (but
    // indicate that the user is using a dehydrated device).  If the user has
    // more than one, that is anomalous, and we show all the devices so that
    // nothing is hidden.
    return {
        devices,
        pushers,
        localNotificationSettings,
        dehydratedDeviceId: dehydratedDeviceIds.length == 1 ? dehydratedDeviceIds[0] : undefined,
    };
}

/*
 * The last list of sessions fetched, per client, and the fetch in flight. The settings are a page now, so
 * the section is opened and left as often as the person moves around, and each time it started from nothing
 * and waited for the server; it now shows what was last known at once and refreshes under it. The fetch
 * can also be started before the section is (prefetchOwnDevices), when the settings column opens.
 */
const snapshots = new WeakMap<MatrixClient, OwnDevicesSnapshot>();
const inFlight = new WeakMap<MatrixClient, Promise<OwnDevicesSnapshot>>();

/** `fresh`: after a change, when a fetch begun before it would be out of date by the time it answered. */
function loadOwnDevices(matrixClient: MatrixClient, fresh = false): Promise<OwnDevicesSnapshot> {
    let pending = inFlight.get(matrixClient);
    if (!pending || fresh) {
        const started: Promise<OwnDevicesSnapshot> = fetchSnapshot(matrixClient)
            .then((snapshot) => {
                snapshots.set(matrixClient, snapshot);
                return snapshot;
            })
            .finally(() => {
                if (inFlight.get(matrixClient) === started) inFlight.delete(matrixClient);
            });
        inFlight.set(matrixClient, started);
        pending = started;
    }
    return pending;
}

/** Starts fetching the sessions ahead of the section that shows them; failures are the section's to show. */
export function prefetchOwnDevices(matrixClient: MatrixClient): void {
    void loadOwnDevices(matrixClient).catch(() => {});
}

export enum OwnDevicesError {
    Unsupported = "Unsupported",
    Default = "Default",
}
export type DevicesState = {
    devices: DevicesDictionary;
    dehydratedDeviceId?: string;
    pushers: IPusher[];
    localNotificationSettings: Map<string, LocalNotificationSettings>;
    currentDeviceId: string;
    isLoadingDeviceList: boolean;
    // not provided when current session cannot request verification
    requestDeviceVerification?: (deviceId: ExtendedDevice["device_id"]) => Promise<VerificationRequest>;
    refreshDevices: () => Promise<void>;
    saveDeviceName: (deviceId: ExtendedDevice["device_id"], deviceName: string) => Promise<void>;
    setPushNotifications: (deviceId: ExtendedDevice["device_id"], enabled: boolean) => Promise<void>;
    error?: OwnDevicesError;
    supportsMSC3881?: boolean | undefined;
};
export const useOwnDevices = (): DevicesState => {
    const sdkContext = useContext(SDKContext);
    const matrixClient = sdkContext.client!;

    const currentDeviceId = matrixClient.getDeviceId()!;
    const userId = matrixClient.getSafeUserId();

    const cached = snapshots.get(matrixClient);
    const [devices, setDevices] = useState<DevicesState["devices"]>(cached?.devices ?? {});
    const [dehydratedDeviceId, setDehydratedDeviceId] = useState<DevicesState["dehydratedDeviceId"]>(
        cached?.dehydratedDeviceId,
    );
    const [pushers, setPushers] = useState<DevicesState["pushers"]>(cached?.pushers ?? []);
    const [localNotificationSettings, setLocalNotificationSettings] = useState<
        DevicesState["localNotificationSettings"]
    >(cached?.localNotificationSettings ?? new Map<string, LocalNotificationSettings>());
    const [isLoadingDeviceList, setIsLoadingDeviceList] = useState(!cached);
    const [supportsMSC3881, setSupportsMSC3881] = useState(true); // optimisticly saying yes!

    const [error, setError] = useState<OwnDevicesError>();

    useEffect(() => {
        void matrixClient.doesServerSupportUnstableFeature("org.matrix.msc3881").then((hasSupport) => {
            setSupportsMSC3881(hasSupport);
        });
    }, [matrixClient]);

    const refresh = useCallback(
        async (quietly: boolean, fresh = false): Promise<void> => {
            // Over what is already shown, a refresh of it is not a reason to draw the skeleton again.
            if (!quietly) setIsLoadingDeviceList(true);
            try {
                const snapshot = await loadOwnDevices(matrixClient, fresh);
                setDevices(snapshot.devices);
                setPushers(snapshot.pushers);
                setLocalNotificationSettings(snapshot.localNotificationSettings);
                setDehydratedDeviceId(snapshot.dehydratedDeviceId);
                setError(undefined);
                setIsLoadingDeviceList(false);
            } catch (error) {
                if ((error as MatrixError).httpStatus == 404) {
                    // 404 probably means the HS doesn't yet support the API.
                    setError(OwnDevicesError.Unsupported);
                } else {
                    logger.error("Error loading sessions:", error);
                    setError(OwnDevicesError.Default);
                }
                setIsLoadingDeviceList(false);
            }
        },
        [matrixClient],
    );
    const refreshDevices = useCallback(() => refresh(false, true), [refresh]);

    // Opened again, it shows what it had and brings it up to date underneath.
    useEffect(() => {
        void refresh(snapshots.has(matrixClient));
    }, [refresh, matrixClient]);

    useEffect(() => {
        const deviceIds = Object.keys(devices);
        // empty devices means devices have not been fetched yet
        // as there is always at least the current device
        if (deviceIds.length) {
            pruneClientInformation(deviceIds, matrixClient);
        }
    }, [devices, matrixClient]);

    useEventEmitter(matrixClient, CryptoEvent.DevicesUpdated, (users: string[]): void => {
        if (users.includes(userId)) {
            void refreshDevices();
        }
    });

    useEventEmitter(matrixClient, ClientEvent.AccountData, (event: MatrixEvent): void => {
        const type = event.getType();
        if (type.startsWith(LOCAL_NOTIFICATION_SETTINGS_PREFIX.name)) {
            const newSettings = new Map(localNotificationSettings);
            const deviceId = type.slice(type.lastIndexOf(".") + 1);
            newSettings.set(deviceId, event.getContent<LocalNotificationSettings>());
            setLocalNotificationSettings(newSettings);
        }
    });

    const isCurrentDeviceVerified = !!devices[currentDeviceId]?.isVerified;

    const requestDeviceVerification =
        isCurrentDeviceVerified && userId
            ? async (deviceId: ExtendedDevice["device_id"]): Promise<VerificationRequest> => {
                  return await matrixClient.getCrypto()!.requestDeviceVerification(userId, deviceId);
              }
            : undefined;

    const saveDeviceName = useCallback(
        async (deviceId: ExtendedDevice["device_id"], deviceName: string): Promise<void> => {
            const device = devices[deviceId];

            // no change
            if (deviceName === device?.display_name) {
                return;
            }

            try {
                await matrixClient.setDeviceDetails(deviceId, { display_name: deviceName });
                await refreshDevices();
            } catch (error) {
                logger.error("Error setting device name", error);
                throw new Error(_t("settings|sessions|error_set_name"));
            }
        },
        [matrixClient, devices, refreshDevices],
    );

    const setPushNotifications = useCallback(
        async (deviceId: ExtendedDevice["device_id"], enabled: boolean): Promise<void> => {
            try {
                const pusher = pushers.find((pusher) => pusher[PUSHER_DEVICE_ID.name] === deviceId);
                if (pusher) {
                    await matrixClient.setPusher({
                        ...pusher,
                        [PUSHER_ENABLED.name]: enabled,
                    });
                } else if (localNotificationSettings.has(deviceId)) {
                    await matrixClient.setLocalNotificationSettings(deviceId, {
                        is_silenced: !enabled,
                    });
                }
            } catch (error) {
                logger.error("Error setting pusher state", error);
                throw new Error(_t("settings|sessions|error_pusher_state"));
            } finally {
                await refreshDevices();
            }
        },
        [matrixClient, pushers, localNotificationSettings, refreshDevices],
    );

    return {
        devices,
        dehydratedDeviceId,
        pushers,
        localNotificationSettings,
        currentDeviceId,
        isLoadingDeviceList,
        error,
        requestDeviceVerification,
        refreshDevices,
        saveDeviceName,
        setPushNotifications,
        supportsMSC3881,
    };
};
