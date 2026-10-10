/**
 * The client-to-server half of foxglove.websocket.v1: publishing to a topic and
 * calling a service. Pure byte and JSON builders, kept apart from the socket so
 * they can be checked against the protocol's published layouts.
 *
 * Binary frames, client to server (uint8 opcode first, little-endian):
 *   0x01 CLIENT_MESSAGE_DATA:  [op][channelId u32][payload...]
 *   0x02 SERVICE_CALL_REQUEST: [op][serviceId u32][callId u32][encodingLen u32][encoding][payload...]
 * Binary frames, server to client:
 *   0x03 SERVICE_CALL_RESPONSE: same layout as the request
 * Capabilities the server lists in serverInfo gate each feature:
 *   "clientPublish" for publishing, "services" for service calls.
 */

export const OP_CLIENT_MESSAGE_DATA = 0x01;
export const OP_SERVICE_CALL_REQUEST = 0x02;
export const OP_SERVICE_CALL_RESPONSE = 0x03;

export const CAP_CLIENT_PUBLISH = 'clientPublish';
export const CAP_SERVICES = 'services';

export interface ClientChannel {
  /** Chosen by the client; unique among its own channels. */
  id: number;
  topic: string;
  encoding: string;
  schemaName: string;
  schema?: string;
  schemaEncoding?: string;
}

export function encodeClientPublish(channelId: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + payload.length);
  const view = new DataView(out.buffer);
  out[0] = OP_CLIENT_MESSAGE_DATA;
  view.setUint32(1, channelId, true);
  out.set(payload, 5);
  return out;
}

export function advertiseClientFrame(channels: ClientChannel[]): string {
  return JSON.stringify({ op: 'advertise', channels });
}

export function unadvertiseClientFrame(channelIds: number[]): string {
  return JSON.stringify({ op: 'unadvertise', channelIds });
}

export interface ServiceCall {
  serviceId: number;
  callId: number;
  encoding: string;
  payload: Uint8Array;
}

export function encodeServiceCall(call: ServiceCall): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(call.encoding);
  const out = new Uint8Array(13 + enc.length + call.payload.length);
  const view = new DataView(out.buffer);
  out[0] = OP_SERVICE_CALL_REQUEST;
  view.setUint32(1, call.serviceId, true);
  view.setUint32(5, call.callId, true);
  view.setUint32(9, enc.length, true);
  out.set(enc, 13);
  out.set(call.payload, 13 + enc.length);
  return out;
}

/** Null when the frame is too short for the lengths it declares. */
export function decodeServiceResponse(buf: ArrayBuffer): ServiceCall | null {
  if (buf.byteLength < 13) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== OP_SERVICE_CALL_RESPONSE) return null;
  const encLen = view.getUint32(9, true);
  if (13 + encLen > buf.byteLength) return null;
  return {
    serviceId: view.getUint32(1, true),
    callId: view.getUint32(5, true),
    encoding: new TextDecoder().decode(new Uint8Array(buf, 13, encLen)),
    payload: new Uint8Array(buf.slice(13 + encLen)),
  };
}
