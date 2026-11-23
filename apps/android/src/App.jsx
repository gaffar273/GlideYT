import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, Linking, NativeModules, PermissionsAndroid, AppState, Pressable, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {createClient, formatTime, normalizeAddress} from '@lan-tube/core';
import {loadSession, saveSession, clearSession} from './session';
import {useRemote} from './useRemote';

const colors = {bg: '#FAF8F7', card: '#FFFFFF', line: '#E7E1E2', text: '#211E20', muted: '#635C60', accent: '#1ED760', playback: '#CD1835', forest: '#163E34', mint: '#DDEFE3', error: '#9F253A'};
const icons = {play: require('./icons/play.png'), pause: require('./icons/pause.png'), search: require('./icons/search.png'),
  disconnect: require('./icons/disconnect.png'), monitor: require('./icons/monitor.png'), back: require('./icons/back.png'), forward: require('./icons/forward.png')};

function Button({label, icon, onPress, disabled, pending, secondary = false, playback = false, accessibilityLabel}) {
  const ink = playback ? '#FFFFFF' : secondary ? colors.forest : '#101B14';
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{disabled: !!disabled || !!pending}}
    disabled={disabled || pending} onPress={onPress} style={({pressed}) => [styles.button, playback && styles.playback, secondary && styles.secondary, {opacity: disabled ? 0.4 : pressed ? 0.7 : 1}]}>
    {icon ? <><Image accessible={false} source={icons[icon]} style={{width: 24, height: 24, tintColor: ink}}/>
      {(icon === 'back' || icon === 'forward') && <Text style={styles.ten}>10</Text>}</> : <Text style={[styles.buttonText, {color: ink}]}>{label}</Text>}
  </Pressable>;
}

function PairScreen({onPaired}) {
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const apply = url => {
      const match = /^lantube:\/\/pair\/([0-9.:]+)\/(\d{6})$/.exec(url || '');
      if (!match) return;
      try { setManual(true); setAddress(normalizeAddress(match[1]).replace('http://', '')); setCode(match[2]); setError(''); } catch {}
    };
    const sub = Linking.addEventListener('url', event => apply(event.url));
    Linking.getInitialURL().then(apply).catch(() => {});
    return () => sub.remove();
  }, []);
  async function scan() {
    setError('');
    try {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (permission !== 'granted') throw new Error('Allow camera access to scan, or enter the code manually.');
      const value = await NativeModules.RemoteTools.scan();
      if (!value) return;
      const match = /^lantube:\/\/pair\/([0-9.:]+)\/(\d{6})$/.exec(value);
      if (!match) throw new Error('Scan the pairing QR in Glide YT on Windows.');
      await pair(match[1], match[2]);
    } catch (failure) { setError(failure.message); }
  }
  async function pair(host = address, digits = code) {
    setError(''); setBusy(true); Keyboard.dismiss();
    try {
      const normalized = normalizeAddress(host);
      if (!/^\d{6}$/.test(digits)) throw new Error('Enter the six-digit code shown on your laptop.');
      const {phoneName, phoneId} = NativeModules.RemoteTools.getConstants();
      const result = await createClient(normalized).pair(digits, phoneName, phoneId);
      const session = {address: normalized, token: result.token, laptopName: result.laptopName, laptopId:result.laptopId};
      await saveSession(session); onPaired(session);
    } catch (failure) {
      setError(failure.name === 'AbortError' || failure.message === 'Network request failed'
        ? 'Cannot reach the laptop. Check its address, Wi-Fi, and Private network firewall access.' : failure.message);
    } finally { setBusy(false); }
  }
  return <View style={styles.pairContent}>
    <View style={styles.deviceMark}><Image source={icons.monitor} style={styles.monitor}/></View>
    <Text style={styles.hero}>Pair your laptop</Text>
    <Text style={styles.description}>Connect both devices to the same Wi-Fi.</Text>
    <View style={styles.pairCard}>
      <Button label={busy ? 'Connecting…' : 'Scan QR code'} disabled={busy} onPress={scan}/>
      <Pressable accessibilityRole="button" onPress={() => setManual(!manual)}><Text style={[styles.help, {textAlign: 'center', padding: 8}]}>{manual ? 'Hide details' : 'Enter manually'}</Text></Pressable>
      {manual && <><Text style={styles.label}>Laptop address</Text>
      <TextInput style={styles.input} accessibilityLabel="Laptop address" placeholder="192.168.1.20:3210" placeholderTextColor="#71686D"
        autoCapitalize="none" autoCorrect={false} keyboardType="url" value={address} onChangeText={setAddress} editable={!busy}/>
      <Text style={styles.label}>Pairing code</Text>
      <TextInput style={[styles.input, styles.codeInput]} accessibilityLabel="Pairing code" placeholder="000000" placeholderTextColor="#71686D"
        keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} editable={!busy} onSubmitEditing={() => pair()}/>

      <Button label={busy ? 'Connecting…' : 'Connect'} disabled={busy || !address || code.length !== 6} onPress={() => pair()}/></>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>

  </View>;
}

function TopBar({children}) {
  return <View style={styles.topbar}><View style={styles.mark}><Image source={require('./icons/glide.png')} style={{width: 22, height: 22, tintColor: '#101B14'}}/></View>
    <Text style={styles.brand}>Glide YT</Text>{children}</View>;
}

function Timeline({state, busy, onSeek, setDragging}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState(null);
  const active = useRef(false);
  const duration = Number.isFinite(state?.duration) ? Math.max(0, state.duration) : 0;
  const position = preview ?? (Number.isFinite(state?.position) ? Math.max(0, state.position) : 0);
  const enabled = !!(state?.connected && state.ready && !state.live && duration && width && !busy);
  const progress = duration ? Math.min(1, position / duration) : 0;
  const timeAt = event => Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * duration;
  useEffect(() => () => { if (active.current) setDragging(false); }, [setDragging]);
  const endDrag = () => {
    active.current = false;
    setDragging(false);
  };
  return <View accessible accessibilityRole="adjustable" accessibilityLabel="Playback position"
    accessibilityState={{disabled: !enabled}} accessibilityValue={{text: state?.live ? 'Live' : formatTime(position) + ' of ' + formatTime(duration)}}
    accessibilityActions={enabled ? [{name: 'increment'}, {name: 'decrement'}] : []}
    onAccessibilityAction={({nativeEvent: {actionName}}) => {
      if (enabled && (actionName === 'increment' || actionName === 'decrement')) onSeek(Math.min(duration, Math.max(0, position + (actionName === 'increment' ? 10 : -10))));
    }}
    style={styles.timeline} onLayout={event => setWidth(event.nativeEvent.layout.width)}
    onStartShouldSetResponder={() => enabled}
    onResponderGrant={event => { active.current = true; setDragging(true); setPreview(timeAt(event)); }}
    onResponderMove={event => { if (active.current && enabled) setPreview(timeAt(event)); }}
    onResponderTerminationRequest={() => false}
    onResponderTerminate={() => { endDrag(); setPreview(null); }}
    onResponderRelease={async event => {
      const target = timeAt(event);
      const commit = active.current && enabled;
      endDrag();
      if (commit) { setPreview(target); await onSeek(target); }
      setPreview(null);
    }}>
    <View pointerEvents="none" style={styles.progressTrack}>
      <View style={[styles.progressFill, {width: progress * width}]}/>
      {duration > 0 && !state?.live && <View style={[styles.thumb, {left: Math.max(0, Math.min(width - 12, progress * width - 6))}]}/>}
    </View>
    <View pointerEvents="none" style={styles.timeRow}><Text style={styles.time}>{formatTime(position)}</Text><Text style={styles.time}>{state?.live ? 'LIVE' : formatTime(duration)}</Text></View>
  </View>;
}

function RemoteScreen({session, onForget, onPause, onSessionChange}) {
  const {client, state, busy, error, command} = useRemote(session, onForget, onSessionChange);
  const [dragging, setDragging] = useState(false);
  const {height, width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState(null);
  const [unavailableQuality, setUnavailableQuality] = useState(null);
  const track = state?.videoId === 'windows-session' ? state.title : state?.videoId;
  useEffect(() => {
    if (!unavailableQuality) return;
    const timer = setTimeout(() => setUnavailableQuality(null), 15000);
    return () => clearTimeout(timer);
  }, [unavailableQuality]);
  const [view, setView] = useState('player');
  const [collection, setCollection] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [more, setMore] = useState(false);
  const [playlists, setPlaylists] = useState([]);
  const [mediaError, setMediaError] = useState('');
  useEffect(() => {
    function connect() {
      NativeModules.RemoteTools.connect(session.address, session.token, session.laptopName)
        .then(() => setMediaError('')).catch(() => setMediaError('Playback notification unavailable.'));
    }
    if (AppState.currentState === 'active') connect();
    const listener = AppState.addEventListener('change', value => { if (value === 'active') connect(); });
    return () => { listener.remove(); NativeModules.RemoteTools.disconnect(); };
  }, [session]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchAbort = useRef(null);
  useEffect(() => () => searchAbort.current?.abort(), []);
  const openPlayer = useCallback(() => { Keyboard.dismiss(); setView('player'); }, []);
  useEffect(() => {
    if (view === 'player') return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => { openPlayer(); return true; });
    return () => back.remove();
  }, [view, openPlayer]);
  async function search() {
    if (!query.trim() || searching) return;
    Keyboard.dismiss(); searchAbort.current?.abort(); searchAbort.current = new AbortController();
    setView('search'); setSearching(true); setSearchError('');
    try { const response = await client.search(query, searchAbort.current.signal); setResults(response.results); }
    catch (failure) { if (failure.name !== 'AbortError') setSearchError(failure.message); }
    finally { setSearching(false); }
  }
  async function browse(type) {
    const response = await command({type});
    if (response?.playlists) { setPlaylists(response.playlists); setView(type); }
  }
  async function choose(item) {
    if (item.listId && view !== 'episodes') {
      await showEpisodes(item);
      return;
    }
    if (item.videoId && item.videoId === state?.videoId && (!item.listId || item.listId === state.listId)) {
      openPlayer();
      return;
    }
    const result = await command(item.listId ? {type: 'playlist', listId: item.listId, videoId: item.videoId, index: item.index} : {type: 'select', videoId: item.videoId});
    if (result) setView('player');
  }
  async function showEpisodes(item, loadMore = false) {
    const response = await command({type: loadMore ? 'moreEpisodes' : 'episodes', listId: item.listId, videoId: item.videoId});
    if (!response?.episodes) return;
    if (!loadMore) setCollection({...item, from: view});
    setEpisodes(response.episodes);
    setMore(response.hasMore);
    setView('episodes');
  }
  const ready = state?.connected;
  const seek = delta => command({type: 'seek', seconds: Math.max(0, (state?.position || 0) + delta)});
  const volume = Number.isFinite(state?.volume) ? Math.round(state.volume * 100) : null;
  async function setting(type, option) {
    if (option === undefined && settings?.type === type) { setSettings(null); return; }
    const result = await command({type, option});
    if (type === 'quality' && result?.options?.length === 0) setUnavailableQuality(track);
    setSettings(result?.options?.length && option === undefined ? {...result, type, videoId: state?.videoId} : null);
  }
  const control = (label, action, disabled, accessibilityLabel = label, selected = false) =>
    <Pressable key={accessibilityLabel} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: !!disabled || busy, selected}} disabled={disabled || busy} onPress={action}
      style={[styles.settingButton, selected && {backgroundColor: colors.accent}, disabled && {opacity: 0.4}]}>
      <Text style={[styles.settingLabel, {color: selected ? '#101B14' : '#FFFFFF'}]}>{label}</Text></Pressable>;
  const hasQueue = !!(state?.listId || state?.hasPrevious || state?.hasNext);
  const artHeight = Math.max(80, Math.min((Math.min(width - insets.left - insets.right, 600) - 66) * 9 / 16,
    (height - insets.top - insets.bottom) * (hasQueue ? 0.19 : 0.24)));
  const header = <>
    <View style={[styles.settingChoices, styles.libraryNav]}>
      {view === 'episodes' && control('Back', () => setView(collection.from), false)}
      {view !== 'player' && !state?.videoId && control('Player', openPlayer, false)}
      {control('Saved playlists', () => browse('saved'), !ready, 'Open saved playlists on laptop', view === 'saved')}
      {control('Suggested', () => browse('suggested'), !ready, 'Suggested playlists', view === 'suggested')}
    </View>
    {view === 'episodes' && <Text numberOfLines={2} style={styles.videoTitle}>{collection?.title}</Text>}
    {view === 'player' && <View style={styles.nowCard}>
      {state?.thumbnail ? <Image source={{uri: state.thumbnail}} resizeMode="contain" style={[styles.art, {height: artHeight}]}/> :
        <View style={styles.artEmpty}><Image source={icons.monitor} style={styles.monitor}/></View>}
      <Text numberOfLines={2} style={styles.videoTitle}>{state?.videoId ? state.title || 'YouTube video' : 'Choose a video'}</Text>
      <Text style={styles.help}>{state?.connected === false ? state.error : state?.videoId ? 'YouTube · ' + (state.playing ? 'Playing' : state.ready ? 'Paused' : 'Loading…') : 'Search YouTube above.'}</Text>
      <Timeline key={state?.videoId} state={state} busy={busy} onSeek={seconds => command({type: 'seek', seconds})} setDragging={setDragging}/>
      <View style={styles.controls}>
        <Button icon="back" label="Back 10 seconds" secondary pending={busy} disabled={!state?.ready || state?.live} onPress={() => seek(-10)}/>
        <View style={styles.playButton}><Button playback icon={state?.playing ? 'pause' : 'play'} label={state?.playing ? 'Pause' : 'Play'} pending={busy} disabled={!state?.ready} onPress={() => command({type: state?.playing ? 'pause' : 'play'})}/></View>
        <Button icon="forward" label="Forward 10 seconds" secondary pending={busy} disabled={!state?.ready || state?.live} onPress={() => seek(10)}/>
      </View>
      {(typeof state?.repeat === 'boolean' || typeof state?.shuffle === 'boolean' || Number.isFinite(state?.sleepUntil)) &&
        <View style={[styles.settingChoices, styles.queue]}>
          {typeof state.repeat === 'boolean' && control('Repeat 1', () => command({type:'repeat', enabled:!state.repeat}), !state.ready, 'Repeat current track', state.repeat)}
          {typeof state.shuffle === 'boolean' && control('Shuffle', () => command({type:'shuffle', enabled:!state.shuffle}), !state.ready, 'Shuffle playback', state.shuffle)}
          {Number.isFinite(state.sleepUntil) && control(state.sleepUntil ? 'Sleep · ' + Math.max(1, Math.ceil((state.sleepUntil - Date.now()) / 60000)) + 'm' : 'Sleep timer',
            () => setSettings(settings?.type === 'sleep' ? null : {type:'sleep', videoId:state.videoId}), !state.ready && !state.sleepUntil, 'Sleep timer', !!state.sleepUntil)}
        </View>}
      {settings?.type === 'sleep' && settings.videoId === state?.videoId && <View style={[styles.settingChoices, styles.queue]}>
        {[15,30,60,0].map(minutes => control(minutes ? minutes + ' min' : 'Off', async () => {
          await command({type:'sleep', minutes}); setSettings(null);
        }, false))}
      </View>}
      {hasQueue && <View style={[styles.settingChoices, styles.queue]}>
        {state?.listId && control('Episodes', () => showEpisodes({listId: state.listId, videoId: state.videoId, title: 'Current playlist'}), false)}
        {control('Previous', () => command({type: 'previous'}), !state?.hasPrevious)}
        {control('Next', () => command({type: 'next'}), !state?.hasNext)}
      </View>}
      <View style={styles.settingRow}>
        <View style={styles.settingGroup}>
          {control('Speed', () => setting('speed'), !state?.ready)}
          {control('Quality', () => setting('quality'), !state?.ready || (!!track && unavailableQuality === track))}
        </View>
        <View style={styles.settingGroup}>
          <Text style={styles.volumeLabel}>Volume{'\n'}{volume === null ? '—' : volume + '%'}</Text>
          {control('−', () => command({type: 'volume', level: Math.max(0, volume - 5) / 100}), volume === null || volume === 0, 'Lower YouTube volume')}
          {control('+', () => command({type: 'volume', level: Math.min(100, volume + 5) / 100}), volume === null || volume === 100, 'Raise YouTube volume')}
        </View>
      </View>
      {state?.ready && settings?.options && settings.videoId === state.videoId && <View style={styles.settingChoices}>
        {settings.options.map(value => control(settings.type === 'speed' ? value + '×' : value,
          () => setting(settings.type, value), false, value, settings.current === value))}
      </View>}
    </View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    
    {!!mediaError && <Text style={styles.error}>{mediaError}</Text>}
    {view === 'search' && !!searchError && <Text accessibilityRole="alert" style={styles.error}>{searchError}</Text>}
    {view === 'search' && searching && <ActivityIndicator style={{padding: 24}} color={colors.accent}/>}
    {view === 'search' && results?.length === 0 && <Text style={styles.help}>No videos found. Try a different search.</Text>}
  </>;
  const library = view === 'saved' || view === 'suggested';
  const rows = view === 'episodes' ? episodes : library ? playlists : view === 'search' ? results || [] : [];
  return <View style={{flex: 1}}>
    <TopBar><View style={styles.connection}><View style={[styles.dot, {backgroundColor: ready ? '#267455' : '#c89060'}]}/>
      <Text style={styles.connectionText} numberOfLines={1}>{session.laptopName}</Text></View>
      <Button icon="disconnect" secondary label="Disconnect" onPress={() => Alert.alert(session.laptopName, 'Disconnect until you reconnect or reopen Glide YT. Forgetting the laptop removes the pairing.', [
        {text: 'Cancel', style: 'cancel'}, {text: 'Forget laptop', style: 'destructive', onPress: async () => { try { await client.unpair(); } catch {} onForget(); }},
        {text:'Disconnect', onPress:() => { onPause(); client.disconnect().catch(() => {}); }},
      ])}/>
    </TopBar>
    <View style={styles.searchRow}>
      <TextInput style={[styles.input, styles.searchInput]} accessibilityLabel="Search YouTube" placeholder="Search YouTube" placeholderTextColor="#71686D"
        value={query} maxLength={160} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={search}/>
      <Button icon="search" label="Search YouTube" disabled={searching || !ready || !query.trim()} onPress={search}/>
    </View>
    <FlatList key={view} scrollEnabled={!dragging} showsVerticalScrollIndicator={false} data={rows} keyExtractor={item => view === 'episodes' ? item.videoId + '-' + item.index : item.listId || item.videoId} ListHeaderComponent={header}
    contentContainerStyle={styles.remoteContent} keyboardShouldPersistTaps="handled" initialNumToRender={6} windowSize={5}
    renderItem={({item}) => <Pressable accessibilityRole="button" accessibilityLabel={(item.listId && view !== 'episodes' ? 'Browse ' : 'Play ') + item.title}
      disabled={busy || !ready} onPress={() => choose(item)}
      style={({pressed}) => [styles.result, pressed && {opacity: 0.6}]}>
      {item.thumbnail && <Image source={{uri: item.thumbnail}} style={styles.thumbnail}/>}
      <View style={styles.resultText}><Text numberOfLines={2} style={styles.resultTitle}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.help}>{item.listId && view !== 'episodes' ? 'Playlist' : item.channel}</Text>{!!item.duration && <Text style={styles.duration}>{item.duration}</Text>}</View>
    </Pressable>} ListFooterComponent={view === 'episodes' && more ? control('Load more episodes', () => showEpisodes(collection, true), false) : null} ListEmptyComponent={view === 'episodes' ? <Text style={styles.help}>No playable episodes found.</Text> : library ? <Text style={styles.help}>{view === 'saved' ? 'No saved playlists found. Check that you’re signed in to YouTube on the laptop.' : 'No playlists suggested for this page.'}</Text> : null}/>
    {view !== 'player' && !!state?.videoId && <Pressable accessibilityRole="button"
      accessibilityLabel={'Return to now playing, ' + (state.title || 'YouTube video')} onPress={openPlayer}
      style={({pressed}) => [styles.nowPlaying, pressed && {opacity: 0.8}]}>
      <View style={styles.resultText}><Text style={styles.nowPlayingLabel}>Now playing</Text>
        <Text numberOfLines={1} style={styles.resultTitle}>{state.title || 'YouTube video'}</Text></View>
      <Text style={styles.openPlayerArrow}>›</Text>
    </Pressable>}
  </View>;
}

function Root() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { if (value === 'active') setPaused(false); });
    return () => listener.remove();
  }, []);
  const activeSession = useRef(null);
  activeSession.current = session;
  const updateConnection = useCallback((previous, changes) => {
    if (activeSession.current !== previous) return;
    const next = {...previous, ...changes};
    activeSession.current = next;
    saveSession(next).catch(error => setStorageError(error.message));
    setSession(next);
  }, []);
  useEffect(() => { loadSession().then(setSession).catch(error => setStorageError(error.message)).finally(() => setLoading(false)); }, []);
  const disconnect = useCallback(() => { activeSession.current = null; clearSession().catch(() => {}); setPaused(false); setSession(null); }, []);
  return <View style={[styles.safe, {paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right}]}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.bg}/>
    {!session && <TopBar/>}
    {loading ? <ActivityIndicator style={{flex: 1}} color={colors.accent}/> : session && paused ? <><TopBar/><View style={styles.pairContent}><Text style={styles.hero}>Disconnected</Text><Text style={styles.description}>{session.laptopName}</Text><Button label="Reconnect" onPress={() => setPaused(false)}/></View></>
      : session ? <RemoteScreen session={session} onForget={disconnect} onPause={() => setPaused(true)} onSessionChange={updateConnection}/>
      : <FlatList showsVerticalScrollIndicator={false} data={[]} renderItem={null} keyboardShouldPersistTaps="handled" ListHeaderComponent={<><PairScreen onPaired={setSession}/>{!!storageError && <Text style={styles.error}>{storageError}</Text>}</>}/>}
  </View>;
}
export default function App() { return <SafeAreaProvider><Root/></SafeAreaProvider>; }

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.bg},
  topbar: {width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8},
  mark: {width: 30, height: 30, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  brand: {fontSize: 19, fontWeight: '700', letterSpacing: -0.6, color: colors.text},
  pairContent: {padding: 24, width: '100%', alignSelf: 'center', maxWidth: 540},
  deviceMark: {width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint},
  monitor: {width: 36, height: 36, tintColor: colors.forest},
  hero: {fontSize: 34, fontWeight: '600', letterSpacing: -1.2, color: colors.text, marginTop: 18},
  description: {fontSize: 15, lineHeight: 22, color: colors.muted, marginTop: 8, marginBottom: 24},
  pairCard: {padding: 20, gap: 10, backgroundColor: colors.card, borderRadius: 22, borderWidth: 1, borderColor: colors.line},
  label: {fontSize: 14, fontWeight: '600', color: colors.text}, input: {borderWidth: 1, borderColor: colors.line, borderRadius: 12,
    padding: 13, color: colors.text, fontSize: 16, backgroundColor: colors.bg, marginBottom: 4}, codeInput: {letterSpacing: 5},
  help: {color: colors.muted, fontSize: 13, lineHeight: 19, marginVertical: 4}, button: {paddingHorizontal: 16, alignItems: 'center',
    justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 16, minHeight: 48, minWidth: 48},
  buttonText: {fontSize: 16, fontWeight: '600'}, secondary: {backgroundColor: colors.mint},
  ten: {position: 'absolute', alignSelf: 'center', color: colors.forest, fontSize: 9, fontWeight: '700', marginTop: 3},
  error: {color: colors.error, fontSize: 14, lineHeight: 20, marginVertical: 12},
  settingRow: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: 10},
  settingGroup: {flexDirection: 'row', alignItems: 'center', gap: 6},
  volumeLabel: {color: colors.muted, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums']},
  settingChoices: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8},
  settingButton: {backgroundColor: colors.forest, minWidth: 44, minHeight: 44, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  settingLabel: {color: colors.text, fontSize: 15, fontWeight: '600'},
  remoteContent: {width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 10},
  libraryNav: {marginTop: 10, marginBottom: 12},
  nowPlaying: {width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: colors.mint, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 10, gap: 12},
  nowPlayingLabel: {color: colors.forest, fontSize: 13, fontWeight: '600'},
  openPlayerArrow: {color: colors.forest, fontSize: 28},
  queue: {justifyContent: 'center'},
  connection: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, flex: 1}, dot: {width: 8, height: 8, borderRadius: 4},
  connectionText: {color: colors.muted, fontSize: 12, flexShrink: 1},
  nowCard: {backgroundColor: colors.card, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: colors.line},
  art: {width: '100%', borderRadius: 12, backgroundColor: '#F0EBED'},
  artEmpty: {height: 100, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F0EBED'},
  videoTitle: {color: colors.text, fontSize: 20, fontWeight: '600', lineHeight: 25, marginTop: 10},
  timeline: {minHeight: 48, justifyContent: 'center'},
  progressTrack: {height: 4, borderRadius: 2, backgroundColor: colors.line},
  playback: {backgroundColor: colors.playback},
  progressFill: {height: 4, borderRadius: 2, backgroundColor: colors.playback},
  thumb: {position: 'absolute', top: -4, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.playback},
  timeRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8},
  time: {color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums']},
  controls: {flexDirection: 'row', gap: 12, justifyContent: 'center'}, playButton: {width: 80},
  searchRow: {width: '100%', maxWidth: 600, alignSelf: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 18}, searchInput: {flex: 1, marginBottom: 0, backgroundColor: colors.card},
  result: {flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line},
  thumbnail: {width: 108, height: 66, borderRadius: 10, backgroundColor: colors.card}, resultText: {flex: 1},
  resultTitle: {color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20}, duration: {color: colors.forest, fontSize: 12},
});
