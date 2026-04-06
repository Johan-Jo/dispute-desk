/**
 * Updates the understandingDashboard help article body in all locale files
 * with the full explanation of KPI cards and Automation Status card fields.
 *
 * Run: node scripts/update-dashboard-help-article.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const load = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
const save = (rel, data) =>
  writeFileSync(resolve(root, rel), JSON.stringify(data, null, 2) + "\n", "utf-8");

const BODIES = {
  "en-US": [
    "The dashboard gives you an at-a-glance view of your dispute operations and lets you control automation from one place.",
    "",
    "**KPI cards**",
    "Four metrics at the top update based on the selected time period (24h / 7d / 30d / All):",
    "- **Active Disputes** — disputes currently open and awaiting a response or under review.",
    "- **Win Rate** — percentage of resolved disputes you won (Won divided by Won + Lost).",
    "- **Evidence Packs** — total evidence packs created for your store.",
    "- **Amount at Risk** — total disputed amount across all currently active disputes.",
    "",
    "Where a previous period exists, each card shows a percentage change (green arrow = improved, red arrow = declined).",
    "",
    "**Automation Status card**",
    "Shows the four pipeline controls for your store:",
    "",
    "- **Auto Build** (ON/OFF) — when a new dispute syncs from Shopify, DisputeDesk automatically creates an evidence pack and starts collecting evidence (order data, tracking info, store policies). If OFF, you click Generate Pack manually on each dispute.",
    "",
    "- **Auto Save** (ON/OFF) — once a pack is built and passes the completeness threshold, DisputeDesk automatically saves it to Shopify so it is attached to the dispute. If OFF, you review the pack first and click Save to Shopify manually.",
    "",
    "- **Min Score** — the completeness percentage a pack must reach before Auto Save fires. A pack below this score waits until more evidence is collected. You can still save manually below the threshold with a confirmation prompt.",
    "",
    "- **Blocker Gate** (ON/OFF) — packs can have blockers: missing critical evidence such as a signed delivery confirmation or a required policy document. When ON, Auto Save is additionally blocked if any blocker is unresolved, regardless of the completeness score. Even a 95% complete pack will not auto-save while a blocker remains.",
    "",
    "**Example:** Auto Build ON, Auto Save OFF, Min Score 80%, Blocker Gate ON — DisputeDesk collects evidence automatically for every new dispute, but you review and save each pack manually before it goes to Shopify.",
    "",
    "**Recent Disputes table**",
    "Lists your five latest chargebacks. Click the order number to jump directly to that order in Shopify Admin, or click View Details to open the dispute and manage its evidence pack.",
  ].join("\n"),

  "de-DE": [
    "Das Dashboard gibt dir einen schnellen Ueberblick ueber deine Streitfalloperationen und ermoeglichst dir, die Automatisierung zentral zu steuern.",
    "",
    "**KPI-Karten**",
    "Vier Kennzahlen oben aktualisieren sich je nach gewahltem Zeitraum (24h / 7d / 30d / Alle):",
    "- **Aktive Streitfaelle** — derzeit offene Streitfaelle, die eine Antwort erfordern oder in Pruefung sind.",
    "- **Gewinnquote** — Anteil der gewonnenen, abgeschlossenen Streitfaelle (Gewonnen geteilt durch Gewonnen + Verloren).",
    "- **Belegnpakete** — Gesamtanzahl der fuer deinen Shop erstellten Belegnpakete.",
    "- **Betrag im Risiko** — Gesamtbetrag aller aktiven Streitfaelle.",
    "",
    "Wenn ein Vorperiodenwert verfuegbar ist, zeigt jede Karte eine prozentuale Veraenderung (gruener Pfeil = verbessert, roter Pfeil = verschlechtert).",
    "",
    "**Karte: Automatisierungsstatus**",
    "Zeigt die vier Pipeline-Steuerungen fuer deinen Shop:",
    "",
    "- **Auto-Erstellen** (AN/AUS) — wenn ein neuer Streitfall von Shopify synchronisiert wird, erstellt DisputeDesk automatisch ein Belegpaket und beginnt mit der Beweissammlung (Bestelldaten, Tracking, Richtlinien). Bei AUS klickst du bei jedem Streitfall manuell auf Paket generieren.",
    "",
    "- **Auto-Speichern** (AN/AUS) — sobald ein Paket erstellt wurde und den Vollstaendigkeitsschwellenwert erreicht, speichert DisputeDesk es automatisch in Shopify. Bei AUS pruefst du das Paket zuerst und klickst manuell auf In Shopify speichern.",
    "",
    "- **Mindestpunktzahl** — der Vollstaendigkeitsprozentsatz, den ein Paket erreichen muss, bevor Auto-Speichern ausgeloest wird. Pakete darunter warten auf mehr Beweise. Du kannst mit einer Bestaetigung trotzdem manuell speichern.",
    "",
    "- **Blocker-Gate** (AN/AUS) — Pakete koennen Blocker haben: fehlende kritische Beweise wie eine Empfangsbestaetigung oder ein Richtliniendokument. Bei AN blockiert Auto-Speichern zusaetzlich, wenn ein Blocker ungeloest ist, unabhaengig von der Punktzahl. Sogar ein 95% vollstaendiges Paket wird nicht automatisch gespeichert, solange ein Blocker besteht.",
    "",
    "**Beispiel:** Auto-Erstellen AN, Auto-Speichern AUS, Mindestpunktzahl 80%, Blocker-Gate AN — DisputeDesk sammelt Beweise automatisch, aber du pruefst und speicherst jedes Paket manuell.",
    "",
    "**Tabelle: Letzte Streitfaelle**",
    "Zeigt deine fuenf neuesten Rueckbuchungen. Klicke auf die Bestellnummer, um direkt zu Shopify Admin zu gelangen, oder auf Details anzeigen, um das Belegpaket zu verwalten.",
  ].join("\n"),

  "es-ES": [
    "El panel te da una vista rapida de tus operaciones de disputas y te permite controlar la automatizacion desde un solo lugar.",
    "",
    "**Tarjetas KPI**",
    "Cuatro metricas en la parte superior se actualizan segun el periodo seleccionado (24h / 7d / 30d / Todo):",
    "- **Disputas activas** — disputas actualmente abiertas que requieren respuesta o estan en revision.",
    "- **Tasa de victorias** — porcentaje de disputas resueltas que ganaste (Ganadas dividido entre Ganadas + Perdidas).",
    "- **Paquetes de evidencia** — total de paquetes de evidencia creados para tu tienda.",
    "- **Importe en riesgo** — importe total disputado en todas las disputas activas.",
    "",
    "Cuando hay datos del periodo anterior, cada tarjeta muestra un cambio porcentual (flecha verde = mejoro, flecha roja = empeoro).",
    "",
    "**Tarjeta: Estado de automatizacion**",
    "Muestra los cuatro controles del pipeline para tu tienda:",
    "",
    "- **Generacion automatica** (ON/OFF) — cuando se sincroniza una nueva disputa desde Shopify, DisputeDesk crea automaticamente un paquete de evidencia y empieza a recopilar pruebas (datos del pedido, seguimiento, politicas). Si esta OFF, haces clic en Generar paquete manualmente en cada disputa.",
    "",
    "- **Guardado automatico** (ON/OFF) — una vez que un paquete esta listo y supera el umbral de completitud, DisputeDesk lo guarda automaticamente en Shopify. Si esta OFF, revisas el paquete primero y haces clic en Guardar en Shopify manualmente.",
    "",
    "- **Puntuacion minima** — el porcentaje de completitud que un paquete debe alcanzar antes de que se active el guardado automatico. Los paquetes por debajo esperan mas evidencia. Puedes guardar manualmente por debajo del umbral con una confirmacion.",
    "",
    "- **Verificacion de bloqueos** (ON/OFF) — los paquetes pueden tener bloqueos: evidencia critica faltante como confirmacion de entrega o documento de politica. Cuando esta ON, el guardado automatico tambien se bloquea si hay algun bloqueo sin resolver, independientemente de la puntuacion. Incluso un paquete 95% completo no se guardara automaticamente mientras haya un bloqueo.",
    "",
    "**Ejemplo:** Generacion automatica ON, Guardado automatico OFF, Puntuacion min. 80%, Verificacion de bloqueos ON — DisputeDesk recopila evidencia automaticamente, pero tu revisas y guardas cada paquete manualmente.",
    "",
    "**Tabla: Disputas recientes**",
    "Lista tus cinco ultimos contracargos. Haz clic en el numero de pedido para ir directamente a Shopify Admin, o en Ver detalles para gestionar el paquete de evidencia.",
  ].join("\n"),

  "fr-FR": [
    "Le tableau de bord offre une vue d'ensemble de vos operations de litiges et vous permet de piloter l'automatisation en un seul endroit.",
    "",
    "**Cartes KPI**",
    "Quatre indicateurs en haut se mettent a jour selon la periode selectionnee (24h / 7j / 30j / Tout) :",
    "- **Litiges actifs** — litiges ouverts necessitant une reponse ou en cours d'examen.",
    "- **Taux de victoire** — pourcentage de litiges resolus remportes (Gagnes divise par Gagnes + Perdus).",
    "- **Paquets de preuves** — nombre total de paquets de preuves crees pour votre boutique.",
    "- **Montant a risque** — montant total conteste sur tous les litiges actifs.",
    "",
    "Lorsque des donnees de la periode precedente sont disponibles, chaque carte affiche une variation en pourcentage (fleche verte = amelioration, fleche rouge = degradation).",
    "",
    "**Carte : Statut d'automatisation**",
    "Affiche les quatre controles du pipeline pour votre boutique :",
    "",
    "- **Creation automatique** (ON/OFF) — lorsqu'un nouveau litige est synchronise depuis Shopify, DisputeDesk cree automatiquement un paquet de preuves et commence a collecter les elements (donnees de commande, suivi, politiques). Si OFF, vous cliquez manuellement sur Generer un paquet pour chaque litige.",
    "",
    "- **Sauvegarde automatique** (ON/OFF) — une fois un paquet constitue et le seuil de completude atteint, DisputeDesk l'enregistre automatiquement dans Shopify. Si OFF, vous verifiez le paquet avant de cliquer sur Enregistrer dans Shopify.",
    "",
    "- **Score minimum** — le pourcentage de completude qu'un paquet doit atteindre avant que la sauvegarde automatique se declenche. Les paquets en dessous attendent que davantage de preuves soient collectees. Vous pouvez enregistrer manuellement en dessous du seuil avec une confirmation.",
    "",
    "- **Blocage des bloqueurs** (ON/OFF) — les paquets peuvent avoir des bloqueurs : preuves critiques manquantes comme une confirmation de livraison signee ou un document de politique. Lorsqu'il est ON, la sauvegarde automatique est egalement bloquee si un bloqueur n'est pas resolu, quel que soit le score. Meme un paquet a 95% ne sera pas sauvegarde automatiquement tant qu'un bloqueur subsiste.",
    "",
    "**Exemple :** Creation automatique ON, Sauvegarde automatique OFF, Score min. 80%, Blocage ON — DisputeDesk collecte les preuves automatiquement, mais vous verifiez et enregistrez chaque paquet manuellement.",
    "",
    "**Tableau : Litiges recents**",
    "Liste vos cinq derniers litiges. Cliquez sur le numero de commande pour acceder directement a Shopify Admin, ou sur Voir les details pour gerer le paquet de preuves.",
  ].join("\n"),

  "pt-BR": [
    "O painel fornece uma visao geral das suas operacoes de disputas e permite controlar a automacao em um so lugar.",
    "",
    "**Cartoes KPI**",
    "Quatro metricas no topo sao atualizadas conforme o periodo selecionado (24h / 7d / 30d / Tudo):",
    "- **Disputas ativas** — disputas atualmente abertas aguardando resposta ou em analise.",
    "- **Taxa de vitoria** — percentual de disputas resolvidas que voce ganhou (Ganhas dividido por Ganhas + Perdidas).",
    "- **Pacotes de evidencia** — total de pacotes de evidencia criados para sua loja.",
    "- **Valor em risco** — valor total contestado em todas as disputas ativas.",
    "",
    "Quando ha dados do periodo anterior, cada cartao exibe uma variacao percentual (seta verde = melhorou, seta vermelha = piorou).",
    "",
    "**Cartao: Status da Automacao**",
    "Mostra os quatro controles do pipeline para sua loja:",
    "",
    "- **Geracao automatica** (ON/OFF) — quando uma nova disputa e sincronizada do Shopify, o DisputeDesk cria automaticamente um pacote de evidencia e comeca a coletar provas (dados do pedido, rastreamento, politicas). Se OFF, voce clica em Gerar pacote manualmente em cada disputa.",
    "",
    "- **Salvamento automatico** (ON/OFF) — assim que um pacote e criado e atinge o limite de completude, o DisputeDesk o salva automaticamente no Shopify para ser vinculado a disputa. Se OFF, voce revisa o pacote primeiro e clica em Salvar no Shopify manualmente.",
    "",
    "- **Pontuacao min.** — o percentual de completude que um pacote deve atingir antes de o salvamento automatico ser ativado. Pacotes abaixo desse limite aguardam mais evidencias serem coletadas. Voce ainda pode salvar manualmente abaixo do limite com uma confirmacao.",
    "",
    "- **Verificacao de bloqueios** (ON/OFF) — pacotes podem ter bloqueios: evidencias criticas ausentes, como confirmacao de entrega assinada ou documento de politica obrigatorio. Quando ON, o salvamento automatico tambem e bloqueado se houver algum bloqueio nao resolvido, independentemente da pontuacao. Mesmo um pacote 95% completo nao sera salvo automaticamente enquanto houver um bloqueio pendente.",
    "",
    "**Exemplo:** Geracao automatica ON, Salvamento automatico OFF, Pontuacao min. 80%, Verificacao de bloqueios ON — o DisputeDesk coleta evidencias automaticamente para cada nova disputa, mas voce revisa e salva cada pacote manualmente antes de envia-lo ao Shopify.",
    "",
    "**Tabela: Disputas recentes**",
    "Lista seus cinco chargebacks mais recentes. Clique no numero do pedido para ir diretamente ao Shopify Admin, ou clique em Ver detalhes para abrir a disputa e gerenciar seu pacote de evidencias.",
  ].join("\n"),

  "sv-SE": [
    "Instrumentpanelen ger dig en snabb overblick over dina tvistoperationer och later dig styra automatiseringen pa ett stalle.",
    "",
    "**KPI-kort**",
    "Fyra matvarden langst upp uppdateras beroende pa vald period (24h / 7d / 30d / Alla):",
    "- **Aktiva tvister** — tvister som ar oppna och vantar pa svar eller granskas.",
    "- **Vinstfrekvens** — andel avgjorda tvister som du vann (Vunna delat med Vunna + Forlorade).",
    "- **Bevispaket** — totalt antal bevispaket som skapats for din butik.",
    "- **Belopp i riskzonen** — totalt omtvistat belopp for alla aktiva tvister.",
    "",
    "Nar foregaende periods data finns tillganglig visas en procentuell forandring pa varje kort (gron pil = forbattring, rod pil = forsamring).",
    "",
    "**Kort: Automatiseringsstatus**",
    "Visar de fyra pipeline-kontrollerna for din butik:",
    "",
    "- **Auto-bygg** (PA/AV) — nar en ny tvist synkroniseras fran Shopify skapar DisputeDesk automatiskt ett bevispaket och borjar samla in bevis (orderdata, sparning, policyer). Om AV klickar du pa Generera paket manuellt for varje tvist.",
    "",
    "- **Auto-spara** (PA/AV) — nar ett paket ar byggt och nar kompletenstroskeln sparar DisputeDesk det automatiskt i Shopify. Om AV granskar du paketet forst och klickar manuellt pa Spara i Shopify.",
    "",
    "- **Minsta poang** — den kompletensprocent ett paket maste na innan auto-spara aktiveras. Paket under troskeln vantar pa mer bevis. Du kan fortfarande spara manuellt under troskeln med en bekraftelse.",
    "",
    "- **Blockerings-gate** (PA/AV) — paket kan ha blockerare: saknat kritiskt bevis som en signerad leveransbekraftelse eller ett policyunderlag. Nar PA blockeras auto-spara aven om blockeraren inte ar lost, oavsett poang. Aven ett 95% komplett paket sparas inte automatiskt medan en blockerare kvarstaar.",
    "",
    "**Exempel:** Auto-bygg PA, Auto-spara AV, Minsta poang 80%, Blockerings-gate PA — DisputeDesk samlar in bevis automatiskt men du granskar och sparar varje paket manuellt.",
    "",
    "**Tabell: Senaste tvister**",
    "Listar dina fem senaste chargebacks. Klicka pa ordernumret for att ga direkt till Shopify Admin, eller klicka pa Visa detaljer for att hantera bevispaket.",
  ].join("\n"),
};

const REGIONAL_FILES = ["en-US", "de-DE", "es-ES", "fr-FR", "pt-BR", "sv-SE"];
const SHORT_MAP = { "de-DE": "de", "es-ES": "es", "fr-FR": "fr", "pt-BR": "pt", "sv-SE": "sv" };

for (const locale of REGIONAL_FILES) {
  const file = `messages/${locale}.json`;
  const data = load(file);
  data.help.embedded.articles.understandingDashboard.body = BODIES[locale];
  save(file, data);
  console.log("✓", file);

  const short = SHORT_MAP[locale];
  if (short) {
    const sf = `messages/${short}.json`;
    const sd = load(sf);
    if (sd.help?.embedded?.articles?.understandingDashboard) {
      sd.help.embedded.articles.understandingDashboard.body = BODIES[locale];
      save(sf, sd);
      console.log("✓", sf, "(mirror)");
    }
  }
}
console.log("Done.");
