import { detectEventSource } from '../src/event-detector';

describe('detectEventSource', () => {
  it('returns null for null input', () => {
    expect(detectEventSource(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(detectEventSource(undefined)).toBeNull();
  });

  it('returns null for string input', () => {
    expect(detectEventSource('string')).toBeNull();
  });

  it('returns null for number input', () => {
    expect(detectEventSource(123)).toBeNull();
  });

  it('returns "scheduled" for aws.events source', () => {
    expect(detectEventSource({ source: 'aws.events' })).toBe('scheduled');
  });

  it('returns "scheduled" for detail-type Scheduled Event', () => {
    expect(detectEventSource({ 'detail-type': 'Scheduled Event' })).toBe('scheduled');
  });

  it('returns "scheduled" for serverless.timer source', () => {
    expect(detectEventSource({ source: 'serverless.timer' })).toBe('scheduled');
  });

  it('returns "scheduled" for triggerType Timer', () => {
    expect(detectEventSource({ triggerType: 'Timer' })).toBe('scheduled');
  });

  it('returns "scheduled" for triggerName + triggerTime', () => {
    expect(detectEventSource({ triggerName: 'x', triggerTime: 'y' })).toBe('scheduled');
  });

  it('returns "sqs" for aws:sqs eventSource', () => {
    expect(detectEventSource({ Records: [{ eventSource: 'aws:sqs' }] })).toBe('sqs');
  });

  it('returns "sns" for aws:sns EventSource', () => {
    expect(detectEventSource({ Records: [{ EventSource: 'aws:sns' }] })).toBe('sns');
  });

  it('returns "s3" for aws:s3 eventSource', () => {
    expect(detectEventSource({ Records: [{ eventSource: 'aws:s3' }] })).toBe('s3');
  });

  it('returns null for httpMethod (HTTP event)', () => {
    expect(detectEventSource({ httpMethod: 'GET' })).toBeNull();
  });

  it('returns null for requestContext.http (HTTP v2)', () => {
    expect(detectEventSource({ requestContext: { http: { method: 'GET' } } })).toBeNull();
  });

  it('returns null for headers (HTTP)', () => {
    expect(detectEventSource({ headers: { host: 'example.com' } })).toBeNull();
  });

  it('returns custom triggerType', () => {
    expect(detectEventSource({ triggerType: 'custom-event' })).toBe('custom-event');
  });

  it('returns null for empty object', () => {
    expect(detectEventSource({})).toBeNull();
  });
});
