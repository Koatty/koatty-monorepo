export function detectEventSource(event: any): string | null {
  if (!event || typeof event !== 'object') return null;

  if (event.source === 'aws.events' || event['detail-type']) {
    return 'scheduled';
  }
  if (event.source === 'serverless.timer' || event.triggerType === 'Timer') {
    return 'scheduled';
  }
  if (event.Records?.[0]?.eventSource === 'aws:sqs') {
    return 'sqs';
  }
  if (event.Records?.[0]?.EventSource === 'aws:sns') {
    return 'sns';
  }
  if (event.Records?.[0]?.eventSource === 'aws:s3') {
    return 's3';
  }
  if (event.triggerName && event.triggerTime) {
    return 'scheduled';
  }
  if (event.httpMethod || event.requestContext?.http || event.headers) {
    return null;
  }

  return event.triggerType || null;
}
