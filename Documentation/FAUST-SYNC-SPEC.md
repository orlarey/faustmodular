# faust-sync — une horloge musicale commune aux applications Faust

*Spécification, version 0.4 (2026-11-06). La 0.1 comptait le temps musical en temps du système ; la 0.2 le comptait
en échantillons audio, mais recalait chaque application sur le temps du système, qui dérive par rapport à la carte
son (§ 10) ; la 0.3 pose l'ancre sur l'horloge audio d'une application, et chaque autre application la traduit par
l'écart entre leurs deux horloges, mesuré une fois et figé (§ 2, § 7) ; la 0.4 compte la position **en entiers** :
des tics (960 par noire), dont l'échantillon est calculé exactement, le même dans toutes les applications (§ 4,
§ 7.3). Réalisée dans faustmodular 3.45.0 (§ 8.1).*

## 1. Objet

Partager un **tempo**, une **mesure** et un **transport** (lecture, arrêt, position) entre les applications Faust
ouvertes dans le même navigateur : faustmodular, faustcode, faustdaw, et les suivantes. Ainsi :

- deux faustmodular, ou un faustmodular et un faustcode, jouent en mesure ;
- n'importe quelle application peut lancer la lecture, l'arrêter ou changer le tempo, et les autres suivent ;
- une application ouverte en cours de route se cale sur les autres.

Elle fonctionne **sans appareil extérieur**, et seule : une application sans partenaire a sa propre ligne de temps.
Une horloge MIDI extérieure peut la piloter (§ 9), sans être nécessaire.

### 1.1 Cas d'usage principal, et critère

Le cas d'usage principal est **un seul navigateur, une seule carte son**. La priorité est la synchronisation des
applications entre elles.

> **Critère d'acceptation.** Deux faustmodular ouverts dans deux onglets, chacun avec un module d'horloge synchronisée
> qui déclenche un son bref sur chaque double croche : les déclenchements des deux applications sortent du
> haut-parleur **au même instant**, à moins de 1 ms près, et le restent pendant une heure de lecture ; y compris
> quand le second onglet est ouvert alors que le premier joue déjà, et après des changements de tempo.

La mesure : l'un des onglets à gauche, l'autre à droite, la sortie enregistrée (une boucle audio, par exemple
BlackHole sur macOS) ; on mesure l'écart des attaques entre les deux canaux (§ 10).

Hors du champ de cette version : la synchronisation entre ordinateurs (il faudrait un serveur, WebRTC, ou un pont
vers Ableton Link) et l'émission d'une horloge MIDI vers des appareils (§ 11).

## 2. Principe

1. **Une règle, pas des impulsions.** On ne s'envoie pas des impulsions (« un temps maintenant ») : chacune hériterait
   du retard variable de son message. On partage la règle qui donne la position musicale :

   > à l'instant *t₀* de l'horloge de l'application *X*, on était au temps musical *b₀*, et l'on avance à *T* temps
   > par minute.

   Un message ne change que la règle, et seulement quand elle change (tempo, lecture, arrêt, position).

2. **Le temps musical avance en échantillons.** Dans chaque application, un nœud audio compte les échantillons de son
   `AudioContext` et en déduit la position musicale à chaque échantillon. Sur une seule carte son, tous les onglets sont
   cadencés par la même horloge matérielle : leurs échantillons avancent exactement au même rythme, sans dérive.

3. **Chaque application a son horloge ; leurs écarts sont fixes.** L'horloge d'une application est le temps de son
   contexte audio qui sort du haut-parleur (§ 7.1). Deux contextes partis à des instants différents ont des horloges
   décalées, mais, sur une même carte, d'un écart **constant** δ (mesuré : à moins d'un échantillon près, sans dérive,
   § 10). Chaque application le mesure une fois pour chaque autre, au calme, puis le **fige** (§ 7.2).

4. **L'ancre est posée sur l'horloge de son auteur.** Une ligne de temps dit sur quelle horloge est son ancre ; les
   autres applications la traduisent dans la leur par δ, une fois. Le temps commun du navigateur (§ 3) ne sert qu'à
   mesurer δ, à ordonner les changements, et à choisir l'instant d'effet d'une opération.

5. **Un effet différé.** Un changement prend effet **20 ms après** avoir été décidé, pour que chaque application le
   reçoive avant et bascule au même échantillon audible.

## 3. Le temps commun

Le temps **epoch** du navigateur, en millisecondes, à haute résolution :

```js
const now = () => performance.timeOrigin + performance.now();
```

Chaque onglet a son `timeOrigin` (l'instant où il s'est ouvert), mais la somme est une même horloge pour tous les
onglets du navigateur (mesuré : § 10). Elle dérive par rapport à la carte son (−38 ppm mesurés sur un Mac, soit
2,3 ms par minute) : on ne compte jamais le temps musical avec elle.

## 4. La ligne de temps

La position se compte en **tics** : PPQ = 960 par noire (le PPQ courant des séquenceurs ; les triolets et les
quintolets tombent juste). Le tempo est au centième de BPM.

```ts
interface Timeline {
    tempo: number;              // temps (noires) par minute, de 20 à 999, au centième
    meter: number;              // temps par mesure (4 : 4/4)
    playing: boolean;
    anchor: {                   // à l'échantillon `frame` du contexte de `clock` (à `sampleRate`), la position
        clock: string; frame: number; sampleRate: number;
        tick: number;           // un entier
        phase: number;          // la fraction de tic, de 0 à 1
    };
    revision: { time: number; origin: string };   // le changement qui l'a produite : quand (temps commun), et par qui
}
```

À un échantillon *n* de l'horloge de l'ancre, en lecture, la position est, en tics :

```
tics(n) = tick + phase + (n − frame) · Tc · PPQ / (6000 · sr)        Tc : le tempo en centièmes de BPM
```

Dans l'horloge d'une autre application *Y* (à la même fréquence), l'échantillon de l'ancre est
`frame − round(δ · sr)`, où δ = t_clock − t_Y est l'écart que *Y* a mesuré avec l'horloge de l'ancre (§ 7.2) ; à une
autre fréquence, `round((frame / sampleRate − δ) · sr_Y)`. La position (tic, phase) ne change pas.

Le temps 0 est le premier temps de la première mesure ; *mesure:temps* = `floor(beat / meter) + 1 : floor(beat mod meter) + 1`
(beat = tics / PPQ). Une ligne de temps neuve : 120 BPM, 4/4, à l'arrêt, au tic 0, de révision 0 (plus ancienne que
tout changement).

## 5. Les opérations

Une opération décidée à l'instant commun `t = now()` prend effet à l'échantillon `e` de l'horloge de son auteur qui
sort du haut-parleur à `t + L`, **L = 20 ms** (§ 2.5). La nouvelle ligne de temps est ancrée sur l'horloge de
l'auteur, à `e`, avec la position exacte qu'il y joue (son nœud Timeline, § 7.3) : elle est continue au tic et à la
phase près (la position ne saute pas, sauf si on le demande) ; sa révision est `{ time: t, origin }` :

| Opération | Nouvelle ligne de temps |
|---|---|
| `setTempo(T)` | `anchor = { soi, e, position(e) }`, `tempo = T` |
| `play()` | `anchor = { soi, e, position(e) }`, `playing = true` (repart d'où l'arrêt l'a laissée) |
| `play({ fromStart: true })` | `anchor = { soi, e, tic 0 }`, `playing = true` |
| `stop()` | `anchor = { soi, e, position(e) }`, `playing = false` |
| `locate(b)` | `anchor = { soi, e, tic round(b · PPQ) }` |
| `setMeter(m)` | `meter = m` |

Une application qui lance la lecture alors que d'autres jouent déjà ne crée rien : elle suit la ligne de temps.

## 6. Le protocole

### 6.1 Le canal et les messages

Un `BroadcastChannel("faust-sync")` : il relie les onglets et fenêtres de la **même origine** dans le même navigateur
(`https://orlarey.github.io` pour faustcode, faustmodular et faustdaw).

```ts
interface Clock {               // l'horloge d'une application (§ 7.1)
    epoch: number;              // change quand son contexte reprend après une suspension
    sampleRate: number;
    line: { T: number; t: number; rate: number; settled: boolean } | null;   // t(T') = t + rate · (T' − T)
}

type SyncMessage =
    | { protocol: "faust-sync"; version: 3; type: "hello"; origin: string }                                    // j'arrive
    | { protocol: "faust-sync"; version: 3; type: "clock"; origin: string; clock: Clock }                      // mon horloge
    | { protocol: "faust-sync"; version: 3; type: "state"; origin: string; timeline: Timeline; clock: Clock }  // la ligne de temps
```

`origin` : le nom de l'application et un identifiant tiré à son ouverture (`"faustmodular:" + crypto.randomUUID()`).
Un message d'une autre `version` est ignoré.

### 6.2 Les règles

1. **Toutes les 500 ms**, chaque application publie son horloge (`clock`). Chacune en déduit son écart δ avec chaque
   autre, et le fige une fois les deux horloges stables (§ 7.2).
2. **À l'ouverture**, une application envoie `hello`. Chaque autre application répond par sa ligne de temps (`state`),
   telle quelle, avec sa **révision inchangée** ; si l'application de l'ancre est partie, l'ancre est d'abord reportée
   sur l'horloge de celle qui répond (par son δ). Sans réponse, l'application est seule.
3. **À chaque opération**, l'application calcule la nouvelle ligne de temps (§ 5), l'adopte et l'envoie.
4. **À la réception** d'un `state`, une application l'adopte si sa révision est plus récente : temps plus grand, puis,
   à égalité, `origin` plus grand (deux changements simultanés finissent sur la même ligne de temps partout). Une
   réponse à un `hello` (même révision) est adoptée par l'application qui arrive, et ignorée par les autres.
5. **Pas de maître** : le dernier changement l'emporte, d'où qu'il vienne. Une application qui se ferme ne change rien :
   les autres gardent leur δ avec son horloge.

### 6.3 Le déroulement : deux applications, l'une ouverte avant l'autre

```mermaid
sequenceDiagram
    autonumber
    participant A as A — faustmodular
    participant C as canal faust-sync
    participant B as B — faustmodular (2ᵉ onglet)

    Note over A: 0 s — s'ouvre
    A->>C: hello {A}
    Note over A: seule : ligne de temps neuve<br/>120 BPM, 4/4, arrêt, temps 0
    A->>C: clock {A} (toutes les 500 ms)

    Note over A: 5 s — ▶ Lecture
    A->>C: state {lecture, 120, ancre (horloge A, e₁ = t_A(maintenant + 20 ms), temps 0), rév. (E, A)}

    Note over B: 65 s — s'ouvre
    B->>C: hello {B}
    C->>A: hello {B}
    A->>C: state {la même ligne de temps, ancre sur l'horloge A, rév. inchangée}
    C->>B: state
    Note over B: adopte ; attend de connaître δ_A
    A->>C: clock {A}
    B->>C: clock {B}
    Note over B: δ_A = t_A(T) − t_B(T) au même instant commun T :<br/>d'abord provisoire, puis figé (≈ 10 s)<br/>ancre traduite : e₁ − δ_A sur son horloge<br/>ses trigs tombent sur ceux de A

    Note over B: 90 s — tempo → 90
    B->>C: state {90 BPM, ancre (horloge B, e₂ = t_B(maintenant + 20 ms), temps 170,04), rév. (E, B)}
    C->>A: state
    Note over A: révision plus récente : adopte<br/>ancre traduite : e₂ − δ_B<br/>les deux passent à 90 BPM au même échantillon audible

    Note over A: 120 s — ■ Arrêt
    A->>C: state {arrêt, ancre (horloge A, e₃, temps 215,0), rév. (E, A)}
    C->>B: state
    Note over A,B: les deux s'arrêtent au même échantillon audible

    Note over A: 130 s — se ferme : rien à envoyer, la ligne de temps continue chez B (δ_A reste connu)
```

*E* : temps commun (ms) ; *t_X* : l'horloge de l'application X (le temps de son contexte qui sort du haut-parleur,
§ 7.1) ; δ_X : l'écart que B a mesuré et figé avec l'horloge de X (§ 7.2).

### 6.4 Les autres cas

- **B s'ouvre alors que tout est à l'arrêt** : A répond par sa ligne de temps à l'arrêt ; B affiche le même tempo et la
  même position.
- **A et B s'ouvrent en même temps** : chacune se croit seule, puis reçoit le `hello` de l'autre et y répond ; la
  révision la plus récente l'emporte (et le contenu est le même).
- **Un message arrive après l'instant d'effet** (onglet très chargé, plus de 20 ms) : l'application l'applique à
  l'échantillon courant, en rattrapant la position (un saut de la durée du retard) ; c'est le seul cas de saut.
- **Un contexte reprend après une suspension** : son temps s'est arrêté pendant la suspension, son écart avec les
  autres a donc changé ; il incrémente son `epoch`, et chacun remesure δ avec lui.

## 7. Dans chaque application

### 7.1 L'horloge

`getOutputTimestamp()` donne un couple : le temps du contexte qui sort du haut-parleur (`contextTime`) et l'instant
de `performance.now()` où il en sort (`performanceTime`). Le navigateur le calcule ainsi : les échantillons calculés
(exact), moins la latence de sortie que le système annonce (une valeur déclarée, pas mesurée), à l'heure de l'appel
de la carte (précise). Lu toutes les 50 ms :

- **la droite** t(T) : sa pente (la dérive entre la carte et le temps commun) sur les 30 dernières secondes, son
  décalage par la médiane de la dernière seconde (une lecture est précise à 40 µs près, § 10) ;
- **la mise en route** : les lectures des 2 premières secondes sont ignorées (fausses de dizaines de ms) ;
- **les sauts** : la latence annoncée peut changer d'un coup (l'ouverture d'un micro, une sortie reconfigurée). Un
  saut (la dernière demi-seconde, toute entière, à plus de 0,25 ms des deux secondes d'avant) est **suivi** pendant les
  5 secondes qui suivent la mise en route, puis **compensé** : l'horloge reste continue. Un système audio qui fonctionne n'interrompt pas
  le son d'une application ; seule la latence annoncée a changé (§ 12).

### 7.2 Les écarts entre horloges

Pour chaque autre application *X*, à chaque horloge publiée : δ_X = t_X(T) − t_soi(T), au même instant commun *T*
(le plus récent des deux). Tant que l'une des deux horloges n'est pas stable, la dernière valeur sert (provisoire).
Quand les valeurs restent à moins de 0,5 ms les unes des autres pendant 2,5 s (5 au moins), δ_X est **figé** à leur
médiane. Sans un tel calme en 10 s (une machine chargée, une horloge bruitée), il est figé quand même, à la médiane
des 5 dernières secondes : une valeur qui ne bouge plus vaut mieux que des corrections sans fin. Il n'est plus
remesuré, sauf si le contexte de l'une des deux reprend après une suspension (§ 6.4).

### 7.3 Le nœud Timeline

Chaque application crée un nœud **Timeline** (un `AudioWorkletProcessor`). Il reçoit par son port la ligne de temps
traduite dans son contexte, en entiers : `{ frame, tick, rem, inc, den, … }`, avec `inc = Tc · PPQ`,
`den = 6000 · sampleRate`, `rem = round(phase · den)`.

- **Le compte** : la position à l'échantillon *n* est `k + r / den`, *k* entier, 0 ≤ *r* < *den*. À chaque échantillon
  en lecture, `r += inc` ; chaque fois que *r* atteint *den*, `r −= den` et `k += 1` (comme l'algorithme de
  Bresenham). Le tic *k* tombe au premier échantillon où la position l'atteint :
  `n_k = frame + ⌈((k − tick) · den − rem) / inc⌉`. Exact : pas d'arrondi, pas de dérive, sur des heures, et le même
  échantillon dans toutes les applications (à la même fréquence, leurs `frame` diffèrent de l'entier round(δ · sr)).
- **Le recalage** : à une nouvelle règle, ou après un bloc qui ne suit pas le précédent, la position est calculée
  exactement à partir de l'ancre, en grands entiers (`BigInt`).
- **Les canaux**, à chaque échantillon : `beat` (la position dans la mesure, en temps, continue), `run` (0 ou 1),
  `start` (1 pendant un échantillon, quand la lecture part du début), `tempo`, `meter`, **`index`** (le tic dans la
  mesure : un entier de 0 à PPQ · meter − 1, exact dans un flottant), **`tick`** (1 à l'échantillon de chaque tic).
- Une nouvelle ligne de temps prend effet à son `frame` (dans le futur, § 5) : le nœud la garde en attente jusqu'à
  cet échantillon, puis bascule, **exactement à l'échantillon**. La traduction n'est refaite qu'à l'arrivée d'une
  ligne de temps, ou quand δ change (provisoire, de plus de 2 ms, puis figé).
- Une petite correction vers l'arrière (moins de 50 ms) ne fait pas reculer la position : elle attend que la nouvelle
  règle la rejoigne. Les corrections, les blocs qui ne suivent pas et les portes irrégulières des modules (une sonde
  mesure leur période et leur largeur à l'échantillon) sont affichés dans l'infobulle du transport.

### 7.4 Cartes son différentes (hors du cas principal)

Deux cartes son ont des horloges qui dérivent : δ ne serait plus constant. En option : suivre δ par sa pente, et
corriger l'écart en douceur (en modifiant imperceptiblement le pas d'une application), jamais par un saut.

## 8. Les applications

### 8.1 faustmodular

Réalisé en 3.43.0, l'algorithme de la 0.3 en 3.44.0, les tics en entiers de la 0.4 en 3.45.0 (`src/sync/`).

- Un **transport** dans la barre d'outils : ⏮ (au début : en lecture, `play({ fromStart: true })`, à l'arrêt,
  `locate(0)`), ▶ / ■, le tempo (modifiable), *mesure:temps*.
- Un module à part, **Sync Clock** (le MIDI Clock reste tel quel). Sorties : *clock* (une porte par double croche,
  croche, noire ou mesure, alignée sur la mesure), *reset* (au départ du début), *run*. Il lit le nœud Timeline par
  cinq entrées réservées, `declare sync "index; run; start; tempo; meter";` : les dernières entrées du DSP, après
  l'audio et les modulations, que l'application branche elle-même (pas des ports du patch). En entiers (0.4) : un pas
  de `step` tics (240, 480, 960, ou 960 · meter), haut pendant ses `high = round(width · step)` premiers tics,
  `clock = run · (index mod step < high)`, à partir du tic qui entre dans le pas (le tic dans le pas retombe de plus
  d'un demi-pas) ou du départ ; pas à la reprise au milieu d'un pas, ni pour un petit recul. Ses portes tombent donc à
  l'échantillon exact du tic, le même dans toutes les applications, et sa largeur suit le tempo sans compteur.
- L'horloge (`ClockLine.ts`), les écarts (`ClockOffset.ts`), la ligne de temps (`Timeline.ts`), le protocole et la
  traduction (`SharedTimeline.ts`), le nœud (`TimelineCore.ts`), testés (`tests/model/clock.test.ts`, `sync.test.ts`).
  De bout en bout, dans Chromium sans carte son : les portes du second onglet, ramenées sur l'horloge du premier par
  le δ figé, tombent sur les siennes à moins de 0,05 ms (la traduction est exacte ; la justesse de δ elle-même se
  mesure avec une carte son, § 10).

### 8.2 faustcode

- Le même transport dans l'en-tête.
- Un programme Faust reçoit la ligne de temps à l'échantillon près par des entrées réservées (`declare sync "index; tick"`, ou `"beat"` pour une position continue),
  branchée sur le nœud Timeline, et, au rythme des blocs, par des métadonnées de widgets : `[sync:tempo]`,
  `[sync:playing]`.

### 8.3 faustdaw

faustdaw compte déjà son temps en échantillons (en unités entières, exactes) et lit à partir d'une ancre
`{ position sur la timeline, instant audio }`, en programmant ses clips une seconde à l'avance : le modèle de faust-sync.
Il lui faut :

1. un **tempo et une mesure** dans le projet, avec la position de la mesure 1 sur la timeline : une règle en
   *mesures:temps*, et le magnétisme des clips sur les temps ;
2. un **pont** entre son transport et la ligne de temps : sa lecture et son arrêt la publient ; une lecture lancée
   ailleurs le fait démarrer à l'instant prévu (son ordonnanceur sait programmer un départ dans le futur) ;
3. la **latence de sortie** prise en compte (`getOutputTimestamp`), comme les autres ;
4. un choix sur les **changements de tempo** : ses clips audio ne s'étirent pas ; c'est la grille qui bouge par rapport
   à eux. Proposition : pendant qu'il joue, son tempo est celui de son projet.

## 9. Une horloge MIDI extérieure

Une application qui reçoit une horloge MIDI peut en faire la ligne de temps commune : le tempo mesuré, Start →
`play({ fromStart: true })`, Stop → `stop()`, le Song Position Pointer → `locate`. C'est une option (le module de
faustmodular, source *MIDI*, case « piloter la ligne de temps »), pour qu'une seule application à la fois la pilote.

## 10. Mesures

Dans Chromium (Playwright, Linux, sans carte son), deux onglets de la même origine :

| Mesure | Résultat |
|---|---|
| Écart des temps communs des deux onglets | 0 à 0,8 ms (la précision de la mesure) |
| Délai d'un message `BroadcastChannel` (200 messages) | médiane 0,3 ms, 95 % sous 0,8 ms, au pire 2 ms |
| Saut de la latence annoncée à l'ouverture d'un micro | +9,2 ms, dans la fenêtre qui l'ouvre seulement |

Sur un Mac (Chrome, deux fenêtres, 48 kHz ; le **laboratoire**, § 10.1) :

| Mesure | Résultat |
|---|---|
| Bruit d'une lecture de `getOutputTimestamp` | σ ≈ 40 µs (la résolution de `performance.now()`, 100 µs, en fait 29) ; toutes dans ±0,1 ms |
| Dérive entre la carte et le temps commun | ≈ −38 ppm, la même dans les deux fenêtres |
| δ entre deux fenêtres, au calme | σ 0,2 à 0,4 échantillon sur une minute, dérive sous 0,5 ppm : constant |
| Avance du calcul sur le haut-parleur | la même dans les deux fenêtres (36,38 et 36,34 ms) |
| Sauts de la latence annoncée | de quelques ms, dans une seule fenêtre, quand elle ouvre un micro |
| Clics de deux fenêtres alignés par δ, enregistrés au micro | −0,70 ms (σ 0,03 ms) au premier essai |
| Aller-retour avec point milieu sur `currentTime` | inutilisable : décalé de l'avance du calcul (jusqu'à 6 ms), dispersé de dizaines de ms |

Ces mesures ont conduit à la 0.3 : δ est constant au calme, et les sauts ne touchent que la latence annoncée d'une
fenêtre ; une droite sur 30 s (comme le faisait la 0.2) les transformait en rampes, d'où des écarts qui s'élargissaient
puis se resserraient.

### 10.1 Le laboratoire

`public/sync-lab/`, servi avec l'application (`…/faustmodular/sync-lab/`), dans deux fenêtres ou plus : le bruit des
lectures, la dérive, les sauts de l'horloge ; δ entre les fenêtres, sa stabilité ; la méthode de l'aller-retour pour
comparaison ; des clics alignés par δ (médiane, droite, ou figé) et leur enregistrement (micro ou bouclage), qui donne
l'erreur réelle au cours du temps. Ses calculs sont testés (`tests/model/sync-lab.test.ts`).

### 10.2 À mesurer encore

1. **le critère lui-même** (§ 1.1) avec deux faustmodular 3.44 : l'écart des attaques au départ, après l'ouverture du
   second en cours de lecture, après des changements de tempo, au bout d'une heure ;
2. le biais éventuel de la latence annoncée entre deux contextes (les −0,70 ms du premier essai) ;
3. un saut avec δ figé (le laboratoire) : confirmer que le son ne bouge pas ;
4. Chrome, puis Firefox et Safari ; un onglet en arrière-plan.

## 11. Limites, et suites possibles

- Même navigateur, même origine : pas entre deux navigateurs, deux profils, deux ordinateurs, ni entre des serveurs de
  développement locaux de ports différents.
- Suites : entre ordinateurs (un serveur WebSocket, WebRTC, ou un pont vers Ableton Link par une petite application
  locale) ; émettre une horloge MIDI vers des appareils, depuis la ligne de temps.

## 12. Décisions

1. Pas de maître : le dernier changement l'emporte (3.43.0).
2. `play()` quand tout est arrêté : tout de suite (+20 ms).
3. Le transport : ⏮, ▶ / ■, tempo, *mesure:temps* ; pas de métronome.
4. Un module à part, Sync Clock ; le MIDI Clock ne pilote pas encore la ligne de temps (§ 9).
5. (0.3) L'ancre sur l'horloge de son auteur ; δ mesuré au calme, puis figé. Pas de référence à élire, pas de recalage
   sur le temps commun.
6. (0.3) Les sauts de la latence annoncée sont compensés, pas suivis : deux applications qui jouent sur une même carte
   n'ont pas de raison d'interrompre leur son ; si elles le faisaient, le système audio ne fonctionnerait pas. Reste
   le cas d'une surcharge (le calcul d'une application arrive trop tard, la carte joue un trou) : on l'entend de toute
   façon ; il sera traité s'il se présente.
7. (0.4) La position en entiers : des tics (960 par noire), comptés par un accumulateur entier ; les portes sont
   définies par le tic, pas déduites d'une position flottante par comparaison de deux valeurs successives.
