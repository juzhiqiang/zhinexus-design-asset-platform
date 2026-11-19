import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

type ProtocolMessage = Parameters<StdioServerTransport['send']>[0];

/** The SDK can reply before a tool handler runs, so redact at its wire boundary. */
export class RedactedStdioServerTransport extends StdioServerTransport {
  private readonly credentials = [process.env.ZHINEXUS_API_TOKEN, process.env.ZHINEXUS_REGISTRY_TOKEN]
    .filter((value): value is string => Boolean(value));

  sanitizeText(text: string): string {
    const representations = new Set<string>();
    for (const credential of this.credentials) {
      let representation = credential;
      // SDK validation diagnostics and our JSON tool content can already contain
      // escaped JSON strings. Remove those forms before the wire is serialized.
      while (representation.length <= text.length) {
        representations.add(representation);
        const escaped = JSON.stringify(representation).slice(1, -1);
        if (escaped === representation) break;
        representation = escaped;
      }
    }
    let sanitized = text;
    for (const representation of [...representations].sort((a, b) => b.length - a.length)) {
      sanitized = sanitized.split(representation).join('[REDACTED]');
    }
    return sanitized;
  }

  private sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') return this.sanitizeText(value);
    if (Array.isArray(value)) return value.map(item => this.sanitizeValue(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.sanitizeText(key), this.sanitizeValue(item)]));
    }
    return value;
  }

  override send(message: ProtocolMessage): Promise<void> {
    // Preserve envelope fields (especially request ids) for protocol correlation.
    // Every SDK result/error and notification payload shares this redaction path.
    const sanitized = { ...message };
    if ('result' in sanitized) sanitized.result = this.sanitizeValue(sanitized.result) as typeof sanitized.result;
    if ('error' in sanitized) sanitized.error = this.sanitizeValue(sanitized.error) as typeof sanitized.error;
    if ('params' in sanitized) sanitized.params = this.sanitizeValue(sanitized.params) as typeof sanitized.params;
    return super.send(sanitized);
  }
}
