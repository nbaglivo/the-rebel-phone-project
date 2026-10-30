import { useDaemonEvent } from './useDaemonEvent'

export interface Screen {
  /** False while the phone is suspending or suspended (idle or power key). */
  on: boolean
}

/** The daemon's `screen` event, or null until the daemon has sent it. */
export const useScreen = () => useDaemonEvent<Screen>('screen')
