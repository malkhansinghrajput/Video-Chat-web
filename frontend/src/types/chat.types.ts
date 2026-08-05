/* Chat-related type definitions */

export interface Message {
  id: string;
  text: string;
  sender: 'self' | 'partner';
  timestamp: number;
  status: 'sent' | 'delivered' | 'failed';
}
