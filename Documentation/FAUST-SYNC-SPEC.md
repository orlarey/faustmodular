# faust-sync — une horloge musicale commune aux applications Faust

*Spécification, version 0.1 (proposition, 2026-11-05).*

## 1. Objet

Partager un **tempo**, une **mesure** et un **transport** (lecture, arrêt, position) entre les applications Faust
ouvertes dans le même navigateur : faustmodular, faustcode, faustdaw, et les suivantes. Ainsi :

- un séquenceur de faustmodular, un programme de faustcode et la lecture de faustdaw jouent en mesure ;
- n'importe quelle application peut lancer la lecture, l'arrêter ou changer le tempo, et les autres suivent ;
- une application ouverte en cours de route se cale sur les autres.

Elle fonctionne **sans appareil extérieur**, et seule : une application sans partenaire a sa propre ligne de temps.
Une horloge MIDI extérieure peut la piloter (§ 7.4), sans être nécessaire.

Hors du champ de cette version : la synchronisation entre ordinateurs (il faudrait un serveur, WebRTC, ou un pont
vers Ableton Link) et l'émission d'une horloge MIDI vers des appareils (§ 9).

## 2. Principe : partager une ligne de temps, pas des impulsions

On ne s'envoie pas des impulsions (« un temps maintenant ») : un message arrive avec un retard variable, et chaque
impulsion en hériterait. On partage la **règle** qui donne la position musicale à tout instant :

> au temps commun *t₀*, on était au temps musical *b₀*, et l'on avance à *T* temps par minute.

Chaque application en déduit elle-même, à l'échantillon près, où elle en est. Un message ne change que la règle, et
seulement quand elle change (tempo, lecture, arrêt, position) : son retard ne décale rien, puisqu'il porte l'instant
où la règle prend effet. C'est le principe d'Ableton Link, sur un seul ordinateur.

## 3. Le temps commun

Le temps commun est le temps **epoch** du navigateur, en millisecondes, à haute résolution :

```js
const now = () => performance.timeOrigin + performance.now();
```

Chaque onglet a son propre `timeOrigin` (le moment où il s'est ouvert), mais leur somme est une même horloge pour
tous les onglets du navigateur. Mesuré dans Chromium (§ 8) : deux onglets s'accordent à moins de 1 ms, ce qui est
la précision de la mesure elle-même.

## 4. La ligne de temps

```ts
interface Timeline {
    tempo: number;              // temps (noires) par minute, de 20 à 999
    meter: number;              // temps par mesure (4 : 4/4), pour aligner les départs et afficher mesure:temps
    playing: boolean;
    anchor: { time: number; beat: number };     // au temps commun `time` (ms), la position était `beat` (en temps)
    revision: { time: number; origin: string }; // le changement qui l'a produite : quand, et par qui
}
```

La position musicale au temps commun *t* :

```
beat(t) = playing ? anchor.beat + (t − anchor.time) × tempo / 60000
                  : anchor.beat
```

- Le temps 0 est le premier temps de la première mesure. *mesure:temps* = `floor(beat / meter) + 1 : floor(beat mod meter) + 1`.
- Une ligne de temps neuve : `{ tempo: 120, meter: 4, playing: false, anchor: { time: now(), beat: 0 } }`.

## 5. Les opérations

Une opération crée une nouvelle ligne de temps, **continue** : la position ne saute pas, sauf si on le demande.
Toutes sont calculées au même instant `t = now()` :

| Opération | Nouvelle ligne de temps |
|---|---|
| `setTempo(T)` | `anchor = { t, beat(t) }`, `tempo = T` (la phase continue, le tempo change à partir de maintenant) |
| `play()` | `anchor = { t, beat(t) }`, `playing = true` (repart d'où l'arrêt l'a laissée) |
| `play({ fromStart: true })` | `anchor = { t, 0 }`, `playing = true` |
| `stop()` | `anchor = { t, beat(t) }`, `playing = false` |
| `locate(b)` | `anchor = { t, b }` (en lecture : saut immédiat) |
| `setMeter(m)` | `meter = m` (la position ne change pas) |

**Départ quantifié** (proposition) : une application qui lance la lecture alors que d'autres jouent déjà ne crée rien :
elle suit la ligne de temps commune. Un `play()` alors que tout est arrêté démarre à la mesure suivante du temps
commun, `anchor.time = t + 50 ms` (le temps de prévenir les autres), pour que toutes démarrent ensemble.

## 6. Le protocole

### 6.1 Le canal

Un `BroadcastChannel("faust-sync")`. Il relie tous les onglets et fenêtres de la **même origine** dans le même
navigateur : `https://orlarey.github.io` pour faustcode, faustmodular et faustdaw. Mesuré dans Chromium (§ 8) :
0,3 ms en médiane, 2 ms au pire.

### 6.2 Les messages

```ts
type SyncMessage =
    | { protocol: "faust-sync"; version: 1; type: "hello"; origin: string }                       // j'arrive
    | { protocol: "faust-sync"; version: 1; type: "state"; origin: string; timeline: Timeline }   // la ligne de temps
```

- `origin` : un identifiant tiré au hasard par chaque application à son ouverture (`crypto.randomUUID()`), et le nom
  de l'application pour l'affichage (`"faustmodular:7f3c…"`).
- Un message d'une autre `version` est ignoré.

### 6.3 Les règles

1. **À l'ouverture**, une application envoie `hello`. Chaque autre application répond par sa ligne de temps (`state`).
   Sans réponse en 200 ms, l'application est seule : elle garde la ligne de temps neuve.
2. **À chaque opération**, l'application calcule la nouvelle ligne de temps, avec `revision = { time: now(), origin }`,
   l'adopte et l'envoie (`state`).
3. **À la réception** d'un `state`, une application l'adopte si sa révision est plus récente que la sienne : temps plus
   grand, puis, à égalité, `origin` plus grand (ordre total : deux changements simultanés finissent sur la même
   ligne de temps partout). Sinon, elle l'ignore.
4. **Pas de maître** : le dernier changement l'emporte, d'où qu'il vienne. Une application qui se ferme ne change
   rien : la ligne de temps continue chez les autres.

## 7. Dans chaque application

### 7.1 Du temps commun au temps audio

Le son d'une application est calculé sur l'horloge de son `AudioContext` (`currentTime`, en secondes). Le lien entre
les deux horloges est donné par `getOutputTimestamp()`, qui dit **quel instant du contexte sort du haut-parleur** à quel
instant de `performance.now()` (la latence de sortie est donc comprise) :

```js
const ts = context.getOutputTimestamp();
const contextTimeOf = (t) => ts.contextTime + (t - (performance.timeOrigin + ts.performanceTime)) / 1000;
```

L'horloge audio (celle de la carte son) et l'horloge du système dérivent l'une par rapport à l'autre (quelques dizaines
de millionièmes, soit quelques millisecondes par minute). La correspondance est donc **recalculée en continu**
(toutes les 100 ms), et l'écart est rattrapé en douceur (en accélérant ou ralentissant imperceptiblement), jamais par
un saut.

### 7.2 La position au rythme de l'échantillon

Chaque application crée un nœud **Timeline** (un `AudioWorkletProcessor`) qui reçoit, par son port, la ligne de temps
traduite en temps du contexte (tempo, lecture, ancre en `contextTime`), et sort à chaque échantillon :

- la **position** en temps (`beat`), la **phase** dans le temps (`beat mod 1`), la **lecture** (0 ou 1).

C'est la seule source de temps musical du son : tout ce qui se cale sur la mesure lit ce signal, à l'échantillon près,
sans dépendre de l'instant où un message arrive.

### 7.3 faustmodular, faustcode, faustdaw

- **faustmodular**
  - Un **transport** dans la barre d'outils : ▶ / ■, le tempo (modifiable), *mesure:temps*.
  - Le module d'horloge synchronisée (le **MIDI Clock** actuel, généralisé) prend sa **source** dans un menu :
    *shared* (la ligne de temps commune, par défaut) ou *MIDI* (une horloge extérieure). Ses sorties ne changent pas :
    *clock* (une porte par double croche, croche, noire ou mesure, alignée sur la mesure), *reset* (au départ), *run*.
    Il reçoit la position du nœud Timeline par une entrée réservée, que l'application branche elle-même (pas un port
    du patch).
- **faustcode**
  - Le même transport dans l'en-tête.
  - Un programme Faust reçoit la ligne de temps par des métadonnées de widgets : `[sync:tempo]`, `[sync:playing]`,
    `[sync:beat]` (la position, mise à jour à chaque bloc), et, à l'échantillon près, par une entrée réservée
    (`declare sync "beat"`) branchée sur le nœud Timeline.
- **faustdaw**
  - Son transport (lecture, arrêt) pilote la ligne de temps commune et la suit ; le tempo et la mesure deviennent ceux
    du projet. Il faut d'abord ajouter à faustdaw un tempo et une grille de mesures : sa ligne de temps est
    aujourd'hui comptée en échantillons.

### 7.4 Une horloge MIDI extérieure

Une application qui reçoit une horloge MIDI (24 messages par noire, Start, Stop) peut en faire la ligne de temps
commune : le tempo mesuré, Start → `play({ fromStart: true })`, Stop → `stop()`, le Song Position Pointer →
`locate`. Toutes les applications suivent alors la boîte à rythmes. C'est une option (le module de faustmodular, source
*MIDI*, case « piloter la ligne de temps »), pour que deux applications ne pilotent pas la ligne de temps à la fois
depuis la même horloge.

## 8. Précision attendue, et mesures

Mesuré dans Chromium (Playwright, Linux, sans charge), deux onglets de la même origine :

| Mesure | Résultat |
|---|---|
| Écart des temps communs des deux onglets | 0 à 0,8 ms (la précision de la mesure) |
| Délai d'un message `BroadcastChannel` (200 messages) | médiane 0,3 ms, 95 % sous 0,8 ms, au pire 2 ms |
| `getOutputTimestamp`, `outputLatency` | disponibles (latence de sortie annoncée : 32 ms) |

La précision attendue entre deux applications est de l'ordre de **la milliseconde**, si leurs sons sortent par le même
périphérique. **À mesurer** sur de vrais ordinateurs, avant de la promettre :

- la dérive entre horloge audio et horloge du système, et la qualité du rattrapage (§ 7.1) ;
- Firefox et Safari (`getOutputTimestamp`, `BroadcastChannel` : à vérifier) ;
- les onglets en arrière-plan (leurs minuteries sont ralenties ; le son et les messages, a priori non).

## 9. Limites, et suites possibles

- **Même navigateur, même origine** : pas entre deux navigateurs, deux profils, deux ordinateurs ; pas entre des
  serveurs de développement locaux de ports différents.
- Des sorties audio sur des **périphériques différents** ont des latences différentes : `getOutputTimestamp` les
  compense en principe, à vérifier.
- Suites : entre ordinateurs (un serveur WebSocket, WebRTC, ou un pont vers Ableton Link par une petite application
  locale) ; émettre une horloge MIDI vers des appareils, depuis la ligne de temps.

## 10. Questions ouvertes

1. Pas de maître, le dernier changement l'emporte (§ 6.3) : est-ce le bon modèle, ou faut-il une application maîtresse ?
2. Le départ quantifié à la mesure (§ 5) : à la mesure suivante, ou tout de suite ?
3. Le transport dans chaque application (§ 7.3) : ▶ / ■, tempo, *mesure:temps* ; faut-il aussi le métronome ?
4. Le module de faustmodular : généraliser le MIDI Clock (source *shared* / *MIDI*), ou un module à part ?
