/**
 * One-shot script to populate help.embedded UI strings and article overrides
 * in all regional locale files, and mirror the shorter locale files.
 *
 * Run:  node scripts/update-help-embedded-i18n.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function load(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), "utf-8"));
}
function save(rel, data) {
  writeFileSync(resolve(root, rel), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ─── Translations per locale ────────────────────────────────────────────────

const TRANSLATIONS = {
  "en-US": {
    ui: {
      title: "Help",
      search: "Search help...",
      backToHelp: "Back to Help",
      relatedArticles: "Related Articles",
      contactSupport: "Need more help? Contact support@disputedesk.app",
      noResults: "No articles found.",
      interactiveGuidesTitle: "Interactive Tours",
      interactiveGuidesDesc: "Step-by-step guidance for key tasks in this app.",
      startGuide: "Start guide",
    },
    articles: {
      connectShopifyStore: {
        title: "Connecting your store in the Shopify app",
        body: "When you install DisputeDesk from the Shopify App Store, your store is connected automatically. You're using the app inside Shopify Admin, so no separate \"connect\" step is needed.\n\nIf you need to reconnect (for example after an app update that requests new permissions):\n1. Open DisputeDesk from Shopify Admin (Apps → DisputeDesk).\n2. If prompted, approve the requested permissions.\n3. Your existing data and settings are preserved.\n\nYour store data is encrypted and never shared with third parties.",
      },
      shopifyAppStoreInstall: {
        title: "Using DisputeDesk from the Shopify App Store",
        body: "You are using DisputeDesk inside Shopify Admin. That is the recommended way to run the app.\n\nIf you have not installed yet:\n1. Find DisputeDesk in the Shopify App Store.\n2. Tap Add app, approve permissions, and finish install.\n3. Open Apps, then DisputeDesk here in Admin.\n\nIf you started from our website: complete any OAuth steps Shopify shows, then keep opening this app from Apps (not only from a bookmark) so your session stays valid.\n\nFor reconnecting after an update, see Connecting your store in the Shopify app.",
      },
      understandingDashboard: {
        title: "Understanding the dashboard in this app",
        body: "The dashboard in this app gives you an at-a-glance overview of your dispute operations.\n\nKey metrics: Open Disputes, Win Rate, Auto-Saved count, and Resolved total.\n\nThe Automation Status card shows your current settings: auto-build, auto-save, minimum completeness score, and blocker gate.\n\nThe Recent Disputes table lists your latest chargebacks. Click the Order number to go directly to that order in Shopify Admin, or click View Details to manage evidence for the dispute.",
      },
      afterSaving: {
        title: "What happens after saving evidence",
        body: "After you save evidence from this app to Shopify:\n\n1. Evidence appears in Shopify Admin: go to Orders → the linked order → Chargeback to review what Shopify received.\n2. Review in Shopify: you can add final notes or make adjustments in Shopify Admin.\n3. Shopify sends evidence to the card network when you click respond in Shopify Admin, or automatically on the dispute's due date.\n4. The card network reviews and resolves the dispute as Won or Lost.\n\nDisputeDesk updates the dispute status when Shopify reports the resolution.",
      },
    },
  },

  "de-DE": {
    ui: {
      title: "Hilfe",
      search: "Hilfe suchen...",
      backToHelp: "Zurück zur Hilfe",
      relatedArticles: "Verwandte Artikel",
      contactSupport: "Weitere Hilfe? Kontaktiere uns: support@disputedesk.app",
      noResults: "Keine Artikel gefunden.",
      interactiveGuidesTitle: "Interaktive Touren",
      interactiveGuidesDesc: "Schritt-für-Schritt-Anleitungen für wichtige Aufgaben in dieser App.",
      startGuide: "Anleitung starten",
    },
    articles: {
      connectShopifyStore: {
        title: "Shop mit der Shopify-App verbinden",
        body: "Wenn du DisputeDesk aus dem Shopify App Store installierst, wird dein Shop automatisch verbunden. Du nutzt die App in Shopify Admin – ein separater Verbindungsschritt ist nicht nötig.\n\nFalls du erneut verbinden musst (z. B. nach einem App-Update mit neuen Berechtigungen):\n1. Öffne DisputeDesk in Shopify Admin (Apps → DisputeDesk).\n2. Bestätige die angeforderten Berechtigungen.\n3. Bestehende Daten und Einstellungen bleiben erhalten.\n\nDeine Shop-Daten sind verschlüsselt und werden nicht an Dritte weitergegeben.",
      },
      shopifyAppStoreInstall: {
        title: "DisputeDesk im Shopify App Store nutzen",
        body: "Du nutzt DisputeDesk in Shopify Admin. Das ist die empfohlene Nutzung.\n\nFalls noch nicht installiert:\n1. Suche DisputeDesk im Shopify App Store.\n2. Tippe auf App hinzufügen, bestätige die Berechtigungen und schliesse die Installation ab.\n3. Oeffne Apps, dann DisputeDesk hier im Admin.\n\nWenn du von unserer Website kommst: Schliesse die OAuth-Schritte bei Shopify ab und oeffne die App weiterhin ueber Apps (nicht nur ueber ein Lesezeichen), damit die Session gueltig bleibt.\n\nNach einem Update: Siehe 'Shop mit der Shopify-App verbinden'.",
      },
      understandingDashboard: {
        title: "Das Dashboard dieser App verstehen",
        body: "Das Dashboard gibt dir einen schnellen Überblick über deine Streitfalloperationen.\n\nKennzahlen: Gesamte Streitfälle, Gewinnquote, Automatisch gespeichert und Gesamt gelöst.\n\nDie Karte Automatisierungsstatus zeigt deine aktuellen Einstellungen: Auto-Erstellen, Auto-Speichern, Mindest-Vollständigkeitsbewertung und Blocker-Gate.\n\nDie Tabelle Letzte Streitfälle listet deine neuesten Rückbuchungen. Klicke auf eine Bestellnummer, um direkt zu dieser Bestellung in Shopify Admin zu gelangen, oder klicke auf Details anzeigen, um Beweise für den Streitfall zu verwalten.",
      },
      afterSaving: {
        title: "Was passiert nach dem Speichern der Beweise",
        body: "Nachdem du Beweise von dieser App in Shopify gespeichert hast:\n\n1. Beweise erscheinen in Shopify Admin: Gehe zu Bestellungen \u2192 die verkn\u00fcpfte Bestellung \u2192 R\u00fcckbuchung.\n2. Du kannst in Shopify Admin abschlie\u00dfende Notizen hinzuf\u00fcgen oder Anpassungen vornehmen.\n3. Shopify sendet die Beweise an das Kartennetzwerk, wenn du in Shopify Admin auf 'Antworten' klickst, oder automatisch zum F\u00e4lligkeitsdatum.\n4. Das Kartennetzwerk pr\u00fcft den Streitfall und l\u00f6st ihn als Gewonnen oder Verloren.\n\nDisputeDesk aktualisiert den Status, wenn Shopify das Ergebnis meldet.",
      },
    },
  },

  "es-ES": {
    ui: {
      title: "Ayuda",
      search: "Buscar ayuda...",
      backToHelp: "Volver a Ayuda",
      relatedArticles: "Artículos relacionados",
      contactSupport: "¿Necesitas más ayuda? Contacta: support@disputedesk.app",
      noResults: "No se encontraron artículos.",
      interactiveGuidesTitle: "Recorridos interactivos",
      interactiveGuidesDesc: "Orientación paso a paso para las tareas clave en esta app.",
      startGuide: "Iniciar guía",
    },
    articles: {
      connectShopifyStore: {
        title: "Conectar tu tienda en la app de Shopify",
        body: "Cuando instalas DisputeDesk desde el App Store de Shopify, tu tienda se conecta automáticamente. Estás usando la app dentro de Shopify Admin, por lo que no se necesita ningún paso adicional de conexión.\n\nSi necesitas volver a conectar (por ejemplo, después de una actualización que solicita nuevos permisos):\n1. Abre DisputeDesk en Shopify Admin (Apps → DisputeDesk).\n2. Aprueba los permisos solicitados.\n3. Tus datos y configuraciones existentes se conservan.\n\nLos datos de tu tienda están cifrados y nunca se comparten con terceros.",
      },
      shopifyAppStoreInstall: {
        title: "Usar DisputeDesk desde el App Store de Shopify",
        body: "Estás usando DisputeDesk dentro de Shopify Admin. Esta es la forma recomendada de ejecutar la app.\n\nSi aún no la has instalado:\n1. Busca DisputeDesk en el App Store de Shopify.\n2. Toca Agregar app, aprueba los permisos y completa la instalación.\n3. Abre Apps, luego DisputeDesk aquí en Admin.\n\nSi comenzaste desde nuestro sitio web: completa los pasos de OAuth que muestra Shopify y continúa abriendo esta app desde Apps (no solo desde un marcador) para que tu sesión siga siendo válida.\n\nPara volver a conectar después de una actualización, consulta Conectar tu tienda en la app de Shopify.",
      },
      understandingDashboard: {
        title: "Entendiendo el panel de control",
        body: "El panel te da una vista general de tus operaciones de disputas.\n\nMétricas clave: Total de disputas, Tasa de victorias, Auto-guardado y Total resueltos.\n\nLa tarjeta Estado de automatización muestra tus ajustes actuales: auto-crear, auto-guardar, puntuación mínima de completitud y bloqueo de bloqueos.\n\nLa tabla Disputas recientes lista tus últimas contracargos. Haz clic en el número de pedido para ir directamente a ese pedido en Shopify Admin, o haz clic en Ver detalles para gestionar evidencias.",
      },
      afterSaving: {
        title: "Qué ocurre después de guardar evidencias",
        body: "Después de guardar evidencias desde esta app a Shopify:\n\n1. Las evidencias aparecen en Shopify Admin: ve a Pedidos → el pedido vinculado → Contracargo.\n2. Puedes añadir notas finales o ajustes en Shopify Admin.\n3. Shopify envía las evidencias a la red de tarjetas cuando haces clic en responder en Shopify Admin, o automáticamente en la fecha de vencimiento.\n4. La red de tarjetas revisa y resuelve la disputa como Ganada o Perdida.\n\nDisputeDesk actualiza el estado cuando Shopify informa la resolución.",
      },
    },
  },

  "fr-FR": {
    ui: {
      title: "Aide",
      search: "Rechercher de l'aide...",
      backToHelp: "Retour à l'aide",
      relatedArticles: "Articles connexes",
      contactSupport: "Besoin d'aide ? Contactez : support@disputedesk.app",
      noResults: "Aucun article trouvé.",
      interactiveGuidesTitle: "Visites guidées interactives",
      interactiveGuidesDesc: "Guidage pas à pas pour les tâches clés dans cette app.",
      startGuide: "Démarrer le guide",
    },
    articles: {
      connectShopifyStore: {
        title: "Connecter votre boutique dans l'app Shopify",
        body: "Lorsque vous installez DisputeDesk depuis le Shopify App Store, votre boutique est connectée automatiquement. Vous utilisez l'app dans Shopify Admin, aucune étape de connexion séparée n'est nécessaire.\n\nSi vous devez reconnecter (par exemple après une mise à jour demandant de nouvelles autorisations) :\n1. Ouvrez DisputeDesk dans Shopify Admin (Apps → DisputeDesk).\n2. Approuvez les autorisations demandées.\n3. Vos données et paramètres existants sont conservés.\n\nVos données sont chiffrées et ne sont jamais partagées avec des tiers.",
      },
      shopifyAppStoreInstall: {
        title: "Utiliser DisputeDesk depuis le Shopify App Store",
        body: "Vous utilisez DisputeDesk dans Shopify Admin. C'est la façon recommandée d'utiliser l'app.\n\nSi vous ne l'avez pas encore installée :\n1. Trouvez DisputeDesk dans le Shopify App Store.\n2. Appuyez sur Ajouter l'app, approuvez les autorisations et terminez l'installation.\n3. Ouvrez Apps, puis DisputeDesk ici dans Admin.\n\nSi vous avez commencé depuis notre site web : complétez les étapes OAuth que Shopify affiche, puis continuez à ouvrir cette app depuis Apps (pas seulement depuis un favori) pour que votre session reste valide.\n\nPour reconnecter après une mise à jour, voir Connecter votre boutique dans l'app Shopify.",
      },
      understandingDashboard: {
        title: "Comprendre le tableau de bord",
        body: "Le tableau de bord vous donne un aperçu de vos opérations de litiges.\n\nIndicateurs clés : Total des litiges, Taux de victoire, Sauvegarde automatique et Total résolu.\n\nLa carte Statut d'automatisation affiche vos paramètres actuels : création automatique, sauvegarde automatique, score minimum de complétude et blocage.\n\nLe tableau Litiges récents liste vos derniers litiges. Cliquez sur le numéro de commande pour aller directement à cette commande dans Shopify Admin, ou cliquez sur Voir les détails pour gérer les preuves.",
      },
      afterSaving: {
        title: "Que se passe-t-il après l'enregistrement des preuves",
        body: "Après avoir enregistré des preuves depuis cette app vers Shopify :\n\n1. Les preuves apparaissent dans Shopify Admin : allez dans Commandes → la commande liée → Litige.\n2. Vous pouvez ajouter des notes finales ou des ajustements dans Shopify Admin.\n3. Shopify envoie les preuves au réseau de cartes lorsque vous cliquez sur répondre dans Shopify Admin, ou automatiquement à la date d'échéance.\n4. Le réseau de cartes examine et résout le litige comme Gagné ou Perdu.\n\nDisputeDesk met à jour le statut lorsque Shopify signale la résolution.",
      },
    },
  },

  "pt-BR": {
    ui: {
      title: "Ajuda",
      search: "Pesquisar ajuda...",
      backToHelp: "Voltar para Ajuda",
      relatedArticles: "Artigos Relacionados",
      contactSupport: "Precisa de mais ajuda? Entre em contato: support@disputedesk.app",
      noResults: "Nenhum artigo encontrado.",
      interactiveGuidesTitle: "Guias Interativos",
      interactiveGuidesDesc: "Orientação passo a passo para as principais tarefas deste app.",
      startGuide: "Iniciar guia",
    },
    articles: {
      connectShopifyStore: {
        title: "Conectando sua loja no app do Shopify",
        body: "Quando você instala o DisputeDesk da Shopify App Store, sua loja é conectada automaticamente. Você está usando o app dentro do Shopify Admin, portanto nenhuma etapa de conexão separada é necessária.\n\nSe precisar reconectar (por exemplo, após uma atualização do app que solicita novas permissões):\n1. Abra o DisputeDesk no Shopify Admin (Apps → DisputeDesk).\n2. Aprove as permissões solicitadas.\n3. Seus dados e configurações existentes são preservados.\n\nOs dados da sua loja são criptografados e nunca compartilhados com terceiros.",
      },
      shopifyAppStoreInstall: {
        title: "Usando o DisputeDesk da Shopify App Store",
        body: "Você está usando o DisputeDesk dentro do Shopify Admin. Essa é a maneira recomendada de usar o app.\n\nSe ainda não instalou:\n1. Encontre o DisputeDesk na Shopify App Store.\n2. Toque em Adicionar app, aprove as permissões e conclua a instalação.\n3. Abra Apps e, em seguida, DisputeDesk aqui no Admin.\n\nSe começou pelo nosso site: conclua as etapas de OAuth que o Shopify mostrar e continue abrindo o app pelo Apps (não apenas por um favorito) para que a sessão permaneça válida.\n\nPara reconectar após uma atualização, consulte Conectando sua loja no app do Shopify.",
      },
      understandingDashboard: {
        title: "Entendendo o painel de controle",
        body: "O painel fornece uma visão geral das suas operações de disputas.\n\nMétricas principais: Total de disputas, Taxa de vitória, Auto-salvo e Total resolvido.\n\nO cartão Status de automação mostra suas configurações atuais: criação automática, salvamento automático, pontuação mínima de completude e gate de bloqueadores.\n\nA tabela Disputas recentes lista seus chargebacks mais recentes. Clique no número do pedido para ir diretamente a esse pedido no Shopify Admin, ou clique em Ver detalhes para gerenciar evidências.",
      },
      afterSaving: {
        title: "O que acontece após salvar as evidências",
        body: "Depois de salvar evidências deste app para o Shopify:\n\n1. As evidências aparecem no Shopify Admin: vá em Pedidos → o pedido vinculado → Estorno.\n2. Você pode adicionar notas finais ou ajustes no Shopify Admin.\n3. O Shopify envia as evidências para a rede de cartões quando você clica em responder no Shopify Admin, ou automaticamente na data de vencimento.\n4. A rede de cartões analisa e resolve a disputa como Ganha ou Perdida.\n\nO DisputeDesk atualiza o status quando o Shopify informa a resolução.",
      },
    },
  },

  "sv-SE": {
    ui: {
      title: "Hjälp",
      search: "Sök hjälp...",
      backToHelp: "Tillbaka till Hjälp",
      relatedArticles: "Relaterade artiklar",
      contactSupport: "Behöver du mer hjälp? Kontakta: support@disputedesk.app",
      noResults: "Inga artiklar hittades.",
      interactiveGuidesTitle: "Interaktiva guider",
      interactiveGuidesDesc: "Steg-för-steg-vägledning för viktiga uppgifter i den här appen.",
      startGuide: "Starta guiden",
    },
    articles: {
      connectShopifyStore: {
        title: "Anslut din butik i Shopify-appen",
        body: "När du installerar DisputeDesk från Shopify App Store ansluts din butik automatiskt. Du använder appen inne i Shopify Admin – inget separat anslutningssteg behövs.\n\nOm du behöver återansluta (t.ex. efter en appuppdatering som begär nya behörigheter):\n1. Öppna DisputeDesk i Shopify Admin (Appar → DisputeDesk).\n2. Godkänn de begärda behörigheterna.\n3. Dina befintliga data och inställningar bevaras.\n\nDina butiksdata är krypterade och delas aldrig med tredje part.",
      },
      shopifyAppStoreInstall: {
        title: "Använda DisputeDesk från Shopify App Store",
        body: "Du använder DisputeDesk inne i Shopify Admin. Det är det rekommenderade sättet att använda appen.\n\nOm du inte har installerat ännu:\n1. Hitta DisputeDesk i Shopify App Store.\n2. Tryck på Lägg till app, godkänn behörigheter och slutför installationen.\n3. Öppna Appar, sedan DisputeDesk här i Admin.\n\nOm du startade från vår webbplats: slutför OAuth-stegen som Shopify visar och öppna sedan alltid appen via Appar (inte bara ett bokmärke) så att din session förblir giltig.\n\nFör att återansluta efter en uppdatering, se Anslut din butik i Shopify-appen.",
      },
      understandingDashboard: {
        title: "Förstå instrumentpanelen",
        body: "Instrumentpanelen ger dig en snabb överblick över dina tvistoperationer.\n\nNyckeltal: Totala tvister, Vinstfrekvens, Automatiskt sparade och Totalt lösta.\n\nKortet Automatiseringsstatus visar dina aktuella inställningar: auto-bygg, auto-spara, minsta komplethetstäng och blockerings-gate.\n\nTabellen Senaste tvister listar dina senaste chargebacks. Klicka på ordernumret för att gå direkt till den ordern i Shopify Admin, eller klicka på Visa detaljer för att hantera bevis.",
      },
      afterSaving: {
        title: "Vad händer efter att bevis sparats",
        body: "Efter att du sparat bevis från den här appen till Shopify:\n\n1. Bevis visas i Shopify Admin: gå till Beställningar → den länkade beställningen → Återkrav.\n2. Du kan lägga till slutliga anteckningar eller justeringar i Shopify Admin.\n3. Shopify skickar bevisen till kortnätverket när du klickar på svara i Shopify Admin, eller automatiskt på förfallodatum.\n4. Kortnätverket granskar och löser tvisten som Vunnen eller Förlorad.\n\nDisputeDesk uppdaterar statusen när Shopify rapporterar lösningen.",
      },
    },
  },
};

// ─── Apply updates ───────────────────────────────────────────────────────────

const REGIONAL_FILES = [
  { file: "messages/en-US.json", locale: "en-US" },
  { file: "messages/de-DE.json", locale: "de-DE" },
  { file: "messages/es-ES.json", locale: "es-ES" },
  { file: "messages/fr-FR.json", locale: "fr-FR" },
  { file: "messages/pt-BR.json", locale: "pt-BR" },
  { file: "messages/sv-SE.json", locale: "sv-SE" },
];

// Shorter locale files mirror their regional counterparts
const SHORT_FILE_MAP = {
  "de-DE": "messages/de.json",
  "es-ES": "messages/es.json",
  "fr-FR": "messages/fr.json",
  "pt-BR": "messages/pt.json",
  "sv-SE": "messages/sv.json",
};

let updated = 0;

for (const { file, locale } of REGIONAL_FILES) {
  const tr = TRANSLATIONS[locale];
  if (!tr) continue;

  const data = load(file);

  if (!data.help) data.help = {};
  if (!data.help.embedded) data.help.embedded = {};

  const emb = data.help.embedded;

  // UI strings
  Object.assign(emb, tr.ui);

  // Articles
  if (!emb.articles) emb.articles = {};
  for (const [key, val] of Object.entries(tr.articles)) {
    emb.articles[key] = val;
  }

  save(file, data);
  console.log(`✓ ${file}`);
  updated++;

  // Mirror to shorter locale file if applicable
  const shortFile = SHORT_FILE_MAP[locale];
  if (shortFile) {
    const shortData = load(shortFile);
    if (!shortData.help) shortData.help = {};
    if (!shortData.help.embedded) shortData.help.embedded = {};
    const shortEmb = shortData.help.embedded;
    Object.assign(shortEmb, tr.ui);
    if (!shortEmb.articles) shortEmb.articles = {};
    for (const [key, val] of Object.entries(tr.articles)) {
      shortEmb.articles[key] = val;
    }
    save(shortFile, shortData);
    console.log(`✓ ${shortFile} (mirror)`);
    updated++;
  }
}

console.log(`\nDone. Updated ${updated} files.`);
