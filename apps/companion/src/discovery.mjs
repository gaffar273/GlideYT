import {createSocket} from 'node:dgram';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {lanAddresses, privateAddress} from './server.mjs';

// A new address must prove possession of the pairing hash before Android sends its bearer.
export function discoveryReply(query, devices, addresses) {
  const match = /^GlideYT-find ([a-f0-9]{32}) ([a-f0-9]{64})$/.exec(query);
  if (!match) return;
  const [, nonce, signature] = match;
  for (const device of devices) {
    const sign = message => createHmac('sha256', Buffer.from(device.hash, 'hex')).update(message).digest();
    if (!timingSafeEqual(sign('find ' + nonce), Buffer.from(signature, 'hex'))) continue;
    const message = ['GlideYT-here', nonce, ...addresses].join(' ');
    return message + ' ' + sign(message).toString('hex');
  }
}

export function startDiscovery(port, pairing) {
  const socket = createSocket('udp4');
  socket.on('message', (packet, peer) => {
    if (packet.length !== 110 || !privateAddress(peer.address)) return;
    const reply = discoveryReply(packet.toString('ascii'), pairing.devices, lanAddresses(port));
    if (reply) socket.send(reply, peer.port, peer.address, () => {});
  });
  socket.on('error', error => console.error('Wi-Fi address discovery unavailable:', error.code));
  socket.bind(port);
  return socket;
}
