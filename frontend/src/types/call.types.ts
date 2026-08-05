/* Call-related type definitions */

export type CallStatus =
  | 'idle'
  | 'permission_pending'
  | 'permission_denied'
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'critical';

export type PartnerStatus = 'connected' | 'camera_off' | 'reconnecting' | null;

export interface ConnectionStats {
  rtt: number;
  packetLoss: number;
  quality: ConnectionQuality;
}
