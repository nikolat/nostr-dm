import {
	type Filter,
	type Sub,
	type UnsignedEvent,
	type Event as NostrEvent,
	SimplePool,
	nip19,
	utils,
} from 'nostr-tools';
import 'websocket-polyfill';
import { NostrAPI } from './@types/nostr';
interface Window {
	nostr?: NostrAPI;
	api?: any;
}
declare const window: Window & typeof globalThis;
interface Profile {
	name: string
	display_name?: string
	about: string
	picture: string
	website?: string
	created_at: number
}

(() => {
	const defaultRelays = [
		'wss://relay-jp.nostr.wirednet.jp',
		'wss://yabu.me',
		'wss://nos.lol',
		'wss://relay.damus.io',
	];
	const dtformat = new Intl.DateTimeFormat('ja-jp', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const pool = new SimplePool();
	const hasDOM: boolean = typeof window === 'object';
	if (!hasDOM) {
		return;
	}
	const relaysRead = document.getElementById('relays-read') as HTMLTextAreaElement;
	relaysRead.value = defaultRelays.join('\n');
	const relaysWrite = document.getElementById('relays-write') as HTMLTextAreaElement;
	relaysWrite.value = defaultRelays.join('\n');
	const loginbutton = document.getElementById('login') as HTMLButtonElement;
	loginbutton.addEventListener('click', async () => {
		if (window.nostr !== undefined) {
			const pubkey = await window.nostr.getPublicKey();
			if (pubkey !== undefined) {
				const npubinput = document.getElementById('npub') as HTMLInputElement;
				npubinput.value = nip19.npubEncode(pubkey);
			}
		}
	});
	const getrelaysbutton = document.getElementById('get-relays') as HTMLButtonElement;
	getrelaysbutton.addEventListener('click', () => {
		const npubinput = document.getElementById('npub') as HTMLInputElement;
		const dr = nip19.decode(npubinput.value);
		if (dr.type !== 'npub') {
			console.warn(`${npubinput.value} is not npub`);
			return;
		}
		getrelaysbutton.textContent = '取得中...';
		getrelaysbutton.disabled = true;
		const pubkey: string = dr.data;
		const filter: Filter = {kinds: [10002], authors: [pubkey]};
		const sub: Sub = pool.sub(defaultRelays, [filter]);
		const events: NostrEvent[] = [];
		sub.on('event', (ev: NostrEvent) => {
			events.push(ev);
		});
		sub.on('eose', () => {
			sub.unsub();
			getrelaysbutton.textContent = '取得';
			getrelaysbutton.disabled = false;
			if (events.length === 0) {
				relaysRead.value = '';
				relaysWrite.value = '';
				return;
			}
			const ev: NostrEvent = events.reduce((a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at ? a : b)
			const newRelaysRead: string[] = [];
			const newRelaysWrite: string[] = [];
			for (const tag of ev.tags.filter(tag => tag.length >= 2 && tag[0] === 'r')) {
				if (tag.length === 2 || tag[2] === 'read') {
					newRelaysRead.push(tag[1]);
				}
				if (tag.length === 2 || tag[2] === 'write') {
					newRelaysWrite.push(tag[1]);
				}
			}
			relaysRead.value = newRelaysRead.join('\n');
			relaysWrite.value = newRelaysWrite.join('\n');
		});
	});
	const senddmbutton = document.getElementById('send-dm') as HTMLButtonElement;
	senddmbutton.addEventListener('click', async () => {
		if (window.nostr === undefined) {
			return;
		}
		const messageinput = document.getElementById('message') as HTMLTextAreaElement;
		const message = messageinput.value;
		if (message === '') {
			console.warn('message is empty');
			return;
		}
		const npubsend = document.getElementById('npub-send') as HTMLInputElement;
		const dr = nip19.decode(npubsend.value);
		if (dr.type !== 'npub') {
			console.warn(`${npubsend.value} is not npub`);
			return;
		}
		senddmbutton.textContent = '送信中...';
		senddmbutton.disabled = true;
		const pubkeysend: string = dr.data;
		const relays = relaysWrite.value.split('\n');
		const baseEvent: UnsignedEvent<4> = {
			kind: 4,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['p', pubkeysend]],
			content: await window.nostr.nip04.encrypt(pubkeysend, message),
			pubkey: await window.nostr.getPublicKey(),
		};
		const newEvent = await window.nostr.signEvent(baseEvent);
		const pubs = pool.publish(relays, newEvent);
		await Promise.all(pubs);
		messageinput.textContent = '';
		senddmbutton.textContent = '送信';
		senddmbutton.disabled = false;
	});
	const receivedmbutton = document.getElementById('receive-dm') as HTMLButtonElement;
	receivedmbutton.addEventListener('click', () => {
		const npubinput = document.getElementById('npub') as HTMLInputElement;
		const dr = nip19.decode(npubinput.value);
		if (dr.type !== 'npub') {
			console.warn(`${npubinput.value} is not npub`);
			return;
		}
		receivedmbutton.textContent = '取得中...';
		receivedmbutton.disabled = true;
		const pubkey: string = dr.data;
		const relays = relaysRead.value.split('\n');
		const filters: Filter[] = [{kinds: [4], authors: [pubkey]}, {kinds: [4], '#p': [pubkey]}];
		const sub: Sub = pool.sub(relays, filters);
		let events: NostrEvent[] = [];
		sub.on('event', (ev: NostrEvent) => {
			events = utils.insertEventIntoDescendingList(events, ev);
		});
		sub.on('eose', () => {
			sub.unsub();
			const pubkeyset = new Set<string>([...events.map(ev => ev.pubkey), ...events.map(ev => ev.tags.find(tag => tag.length >= 2 && tag[1] === 'p')?.at(1) ?? '')]);
			const pubkeys = Array.from(pubkeyset);
			const filter2: Filter = {kinds: [0], authors: pubkeys};
			const sub2: Sub = pool.sub(relays, [filter2]);
			const events2: NostrEvent[] = [];
			sub2.on('event', (ev: NostrEvent) => {
				events2.push(ev);
			});
			sub2.on('eose', () => {
				sub2.unsub();
				receivedmbutton.textContent = '取得';
				receivedmbutton.disabled = false;
				const profs: {[key: string]: Profile} = {};
				for (const ev of events2) {
					if ((profs[ev.pubkey] && profs[ev.pubkey].created_at < ev.created_at) || !profs[ev.pubkey]) {
						try {
							profs[ev.pubkey] = JSON.parse(ev.content);
						} catch (error) {
							console.warn(error);
							continue;
						}
						profs[ev.pubkey].created_at = ev.created_at;
					}
				}
				const dm = document.getElementById('dm') as HTMLElement;
				dm.innerHTML = '';
				for (const ev of events) {
					const time = document.createElement('time');
					time.textContent = dtformat.format(new Date(ev.created_at * 1000));
					const dt = document.createElement('dt');
					if (profs[ev.pubkey]?.picture !== undefined) {
						const img = document.createElement('img');
						img.src = profs[ev.pubkey].picture;
						dt.appendChild(img);
					}
					const p = ev.tags.find(tag => tag.length >= 2 && tag[0] === 'p')?.at(1) ?? '';
					dt.appendChild(document.createTextNode(` ${profs[ev.pubkey]?.display_name ?? ''} @${profs[ev.pubkey]?.name ?? ''} to `));
					if (profs[p]?.picture !== undefined) {
						const img = document.createElement('img');
						img.src = profs[p].picture;
						dt.appendChild(img);
					}
					dt.appendChild(document.createTextNode(` ${profs[p]?.display_name ?? ''} @${profs[p]?.name ?? ''} `));
					dt.appendChild(time);
					const btn = document.createElement('button');
					btn.textContent = '復号';
					btn.addEventListener('click', async () => {
						if (window.nostr === undefined) {
							return;
						}
						const pubkey = await window.nostr.getPublicKey() === ev.pubkey ? p : ev.pubkey;
						dd.textContent = await window.nostr.nip04.decrypt(pubkey, ev.content);
					});
					const dd = document.createElement('dd');
					dd.appendChild(btn);
					dd.appendChild(document.createTextNode(ev.content));
					dm.appendChild(dt);
					dm.appendChild(dd);
				}
			});
		});
	});
})();
