import {
	type Filter,
	type Sub,
	type Event as NostrEvent,
	SimplePool,
	nip19,
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

(function (){
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
	const relaystextarea: HTMLTextAreaElement = document.getElementById('relays') as HTMLTextAreaElement;
	relaystextarea.value = defaultRelays.join('\n');
	const loginbutton: HTMLButtonElement = document.getElementById('login') as HTMLButtonElement;
	loginbutton.addEventListener('click', async () => {
		if (window.nostr !== undefined) {
			const pubkey = await window.nostr.getPublicKey();
			if (pubkey !== undefined) {
				const npubinput: HTMLInputElement = document.getElementById('npub') as HTMLInputElement;
				npubinput.value = nip19.npubEncode(pubkey);
			}
		}
	});
	const getrelaysbutton: HTMLButtonElement = document.getElementById('get-relays') as HTMLButtonElement;
	getrelaysbutton.addEventListener('click', function(){
		const npubinput: HTMLInputElement = document.getElementById('npub') as HTMLInputElement;
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
				relaystextarea.value = '';
				return;
			}
			const ev: NostrEvent = events.reduce((a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at ? a : b)
			const newRelays: string[] = [];
			for (const tag of ev.tags.filter(tag => tag.length >= 2 && tag[0] === 'r')) {
				newRelays.push(tag[1]);
			}
			relaystextarea.value = newRelays.join('\n');
		});
	});
	const getdmbutton: HTMLButtonElement = document.getElementById('get-dm') as HTMLButtonElement;
	getdmbutton.addEventListener('click', function(){
		const npubinput: HTMLInputElement = document.getElementById('npub') as HTMLInputElement;
		const dr = nip19.decode(npubinput.value);
		if (dr.type !== 'npub') {
			console.warn(`${npubinput.value} is not npub`);
			return;
		}
		getdmbutton.textContent = '取得中...';
		getdmbutton.disabled = true;
		const pubkey: string = dr.data;
		const relays = relaystextarea.value.split('\n');
		const filters: Filter[] = [{kinds: [4], authors: [pubkey]}, {kinds: [4], '#p': [pubkey]}];
		const sub: Sub = pool.sub(relays, filters);
		const events: NostrEvent[] = [];
		sub.on('event', (ev: NostrEvent) => {
			events.push(ev);
		});
		sub.on('eose', () => {
			sub.unsub();
			events.sort((a, b) => {
				if (a.created_at < b.created_at) {
					return 1;
				}
				if (a.created_at > b.created_at) {
					return -1;
				}
				return 0;
			});
			const pubkeys = Array.from(new Set<string>(events.map(ev => ev.pubkey)));
			const filter2: Filter = {kinds: [0], authors: pubkeys};
			const sub2: Sub = pool.sub(relays, [filter2]);
			const events2: NostrEvent[] = [];
			sub2.on('event', (ev: NostrEvent) => {
				events2.push(ev);
			});
			sub2.on('eose', () => {
				sub2.unsub();
				getdmbutton.textContent = '取得';
				getdmbutton.disabled = false;
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
					if (profs[ev.pubkey].picture !== undefined) {
						const img = document.createElement('img');
						img.src = profs[ev.pubkey].picture;
						dt.appendChild(img);
					}
					dt.appendChild(document.createTextNode(` ${profs[ev.pubkey].display_name ?? ''} @${profs[ev.pubkey].name} `));
					dt.appendChild(time);
					const btn = document.createElement('button');
					btn.textContent = '復号';
					btn.addEventListener('click', async () => {
						if (window.nostr === undefined) {
							return;
						}
						const pubkey = await window.nostr.getPublicKey() === ev.pubkey ? ev.tags.find(tag => tag.length >= 2 && tag[0] === 'p')?.at(1) ?? '' : ev.pubkey;
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
