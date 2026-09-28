import { EventEmitter } from 'events';
import { createTestApp } from '../../src/testApp';
import { createApplication } from 'koatty';
jest.mock('koatty', () => ({ createApplication: jest.fn() }));
const create = createApplication as jest.Mock;
class TestApp {}
afterEach(()=>{jest.restoreAllMocks();delete process.env.KOATTY_E_LIFECYCLE;});
test('start resolves on callback and is idempotent',async()=>{
  const app:any=new EventEmitter(); let ready:()=>void=()=>{};
  app.listen=jest.fn(cb=>{ready=cb;}); app.stop=jest.fn(); create.mockResolvedValue(app);
  const wrapper=await createTestApp(TestApp as any);
  let settled=false; const started=wrapper.start().then(()=>{settled=true;});
  await Promise.resolve(); expect(settled).toBe(false); ready(); await started; await wrapper.start();
  expect(app.listen).toHaveBeenCalledTimes(1);expect(app.listenerCount('error')).toBe(0); await wrapper.stop();
});
test('listen errors reject start',async()=>{
  const app:any=new EventEmitter(); app.listen=()=>{app.emit('error',Error('bind failed'));};app.stop=jest.fn();create.mockResolvedValue(app);
  const wrapper=await createTestApp(TestApp as any);await expect(wrapper.start()).rejects.toThrow('bind failed');expect(app.listenerCount('error')).toBe(0);await wrapper.stop();
});
test('stop failure restores environment exactly once',async()=>{
  process.env.KOATTY_E_LIFECYCLE='original';const app:any={stop:jest.fn().mockRejectedValue(Error('cleanup failed'))};create.mockResolvedValue(app);
  const wrapper=await createTestApp(TestApp as any,{env:{KOATTY_E_LIFECYCLE:'fixture'}});
  await expect(wrapper.stop()).rejects.toThrow('cleanup failed');expect(process.env.KOATTY_E_LIFECYCLE).toBe('original');
  process.env.KOATTY_E_LIFECYCLE='later';await expect(wrapper.stop()).rejects.toThrow();expect(process.env.KOATTY_E_LIFECYCLE).toBe('later');
});
test('bootstrap failure restores absent environment',async()=>{
  create.mockRejectedValue(Error('bootstrap failed'));
  await expect(createTestApp(TestApp as any,{env:{KOATTY_E_LIFECYCLE:'fixture'}})).rejects.toThrow('bootstrap failed');expect(process.env.KOATTY_E_LIFECYCLE).toBeUndefined();
});
