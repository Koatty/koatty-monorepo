import { EventEmitter } from 'events';
import { ConnectionTracker } from '../../src/server/connection-tracker';
const connection = () => Object.assign(new EventEmitter(), {destroy: jest.fn()});
test('tracks incoming connections once, rejects overflow, and removes only its listener', () => {
  const tracker = new ConnectionTracker(1), a = connection(), b = connection();
  const observer = jest.fn(); a.on('close', observer);
  expect(tracker.add(a)).toBe(true); expect(tracker.add(a)).toBe(true);
  expect(tracker.add(b)).toBe(false); expect(b.destroy).toHaveBeenCalledTimes(1);
  expect(tracker.stats()).toEqual({activeConnections:1,totalConnections:1,rejectedConnections:1});
  expect(tracker.health().status).toBe('overloaded');
  a.emit('close'); expect(tracker.size).toBe(0); expect(a.listeners('close')).toEqual([observer]);
});
test('attempts every close and releases bookkeeping even if one transport throws', () => {
  const tracker = new ConnectionTracker(), a = connection(), b = connection();
  a.destroy.mockImplementation(() => {throw Error('broken socket')});
  tracker.add(a);tracker.add(b);
  expect(() => tracker.closeAll()).toThrow('Connection cleanup failed');
  expect(b.destroy).toHaveBeenCalledTimes(1); expect(tracker.size).toBe(0);
  expect(a.listenerCount('close')).toBe(0);expect(b.listenerCount('close')).toBe(0);
});
test.each(['terminate','destroy','close'])('closes a transport through %s without polling', method => {
  const interval = jest.spyOn(global,'setInterval');
  const tracker = new ConnectionTracker(), fn=jest.fn();
  tracker.add({[method]:fn});tracker.closeAll();tracker.closeAll();
  expect(fn).toHaveBeenCalledTimes(1);expect(interval).not.toHaveBeenCalled();interval.mockRestore();
});
