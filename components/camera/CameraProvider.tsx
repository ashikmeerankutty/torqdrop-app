import { requireOptionalNativeModule } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useRef, useState } from 'react';
import { Alert, Modal } from 'react-native';

export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
}

export interface CaptureOptions {
  /** Shown at the top of the camera, e.g. the check's name. */
  title?: string;
  /** Short framing tip under the title. */
  hint?: string;
  /** Draws a document-shaped frame to line the RC or policy up in. */
  frame?: 'document';
}

type Capture = (opts?: CaptureOptions) => Promise<CapturedPhoto | null>;

const CaptureContext = createContext<Capture>(async () => null);

// Builds made before expo-camera was added don't have it; they fall back to the system camera.
const hasInAppCamera = !!requireOptionalNativeModule('ExpoCamera');
const InAppCamera = lazy(() => import('./InAppCamera'));

/**
 * Takes photos with the in-app camera, which always opens on the back lens (system camera apps on
 * Android often reopen whichever lens was used last). `useCapture()` returns the function to call.
 */
export function CameraProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<CaptureOptions | null>(null);
  const resolver = useRef<((photo: CapturedPhoto | null) => void) | null>(null);

  const capture = useCallback<Capture>(async (opts = {}) => {
    if (!hasInAppCamera) return systemCamera();
    resolver.current?.(null);
    return new Promise<CapturedPhoto | null>((resolve) => {
      resolver.current = resolve;
      setRequest(opts);
    });
  }, []);

  const finish = useCallback((photo: CapturedPhoto | null) => {
    resolver.current?.(photo);
    resolver.current = null;
    setRequest(null);
  }, []);

  return (
    <CaptureContext.Provider value={capture}>
      {children}
      {hasInAppCamera && (
        <Modal visible={!!request} animationType="slide" onRequestClose={() => finish(null)} statusBarTranslucent>
          {request && (
            <Suspense fallback={null}>
              <InAppCamera options={request} onDone={finish} />
            </Suspense>
          )}
        </Modal>
      )}
    </CaptureContext.Provider>
  );
}

export function useCapture(): Capture {
  return useContext(CaptureContext);
}

async function systemCamera(): Promise<CapturedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Camera access needed', 'Allow camera access in Settings to take inspection photos.');
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality: 1,
    cameraType: ImagePicker.CameraType.back,
  });
  if (result.canceled) return null;
  const { uri, width, height } = result.assets[0];
  return { uri, width, height };
}
