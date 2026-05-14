#!/usr/bin/env node
// One-shot: add analysis-in-progress card copy + improve "How it works
// from here" description on the onboarding completion screen.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "..", "messages");

const COPY = {
  "en.json": {
    analysisTitle: "We're analyzing your historical orders",
    analysisDesc: "DisputeDesk is reviewing your past Shopify orders to build a risk snapshot for your store. You'll get an email with the results as soon as the analysis is done — typically within a few hours.",
    infoTitle: "How it works from here",
    infoDesc: "New disputes sync from Shopify automatically. DisputeDesk builds the evidence pack and saves it back to your dispute in Shopify Admin. You review the pack there and submit it to the card network when you're ready.",
  },
  "en-US.json": {
    analysisTitle: "We're analyzing your historical orders",
    analysisDesc: "DisputeDesk is reviewing your past Shopify orders to build a risk snapshot for your store. You'll get an email with the results as soon as the analysis is done — typically within a few hours.",
    infoTitle: "How it works from here",
    infoDesc: "New disputes sync from Shopify automatically. DisputeDesk builds the evidence pack and saves it back to your dispute in Shopify Admin. You review the pack there and submit it to the card network when you're ready.",
  },
  "de.json": {
    analysisTitle: "Wir analysieren Ihre bisherigen Bestellungen",
    analysisDesc: "DisputeDesk überprüft Ihre bisherigen Shopify-Bestellungen, um einen Risiko-Snapshot für Ihren Shop zu erstellen. Sie erhalten eine E-Mail mit den Ergebnissen, sobald die Analyse abgeschlossen ist — in der Regel innerhalb weniger Stunden.",
    infoTitle: "So geht es ab hier weiter",
    infoDesc: "Neue Streitfälle werden automatisch aus Shopify synchronisiert. DisputeDesk erstellt das Beweispaket und speichert es wieder im Shopify Admin bei Ihrem Streitfall. Sie prüfen das Paket dort und reichen es bei der Kartennetzwerk ein, wenn Sie bereit sind.",
  },
  "de-DE.json": {
    analysisTitle: "Wir analysieren Ihre bisherigen Bestellungen",
    analysisDesc: "DisputeDesk überprüft Ihre bisherigen Shopify-Bestellungen, um einen Risiko-Snapshot für Ihren Shop zu erstellen. Sie erhalten eine E-Mail mit den Ergebnissen, sobald die Analyse abgeschlossen ist — in der Regel innerhalb weniger Stunden.",
    infoTitle: "So geht es ab hier weiter",
    infoDesc: "Neue Streitfälle werden automatisch aus Shopify synchronisiert. DisputeDesk erstellt das Beweispaket und speichert es wieder im Shopify Admin bei Ihrem Streitfall. Sie prüfen das Paket dort und reichen es bei der Kartennetzwerk ein, wenn Sie bereit sind.",
  },
  "es.json": {
    analysisTitle: "Estamos analizando tus pedidos históricos",
    analysisDesc: "DisputeDesk está revisando tus pedidos anteriores de Shopify para crear una instantánea de riesgo de tu tienda. Recibirás un correo con los resultados en cuanto termine el análisis — normalmente en unas horas.",
    infoTitle: "Cómo funciona a partir de ahora",
    infoDesc: "Las nuevas disputas se sincronizan automáticamente desde Shopify. DisputeDesk crea el paquete de evidencia y lo guarda en tu disputa en el Admin de Shopify. Tú revisas el paquete allí y lo envías a la red de tarjetas cuando estés listo.",
  },
  "es-ES.json": {
    analysisTitle: "Estamos analizando tus pedidos históricos",
    analysisDesc: "DisputeDesk está revisando tus pedidos anteriores de Shopify para crear una instantánea de riesgo de tu tienda. Recibirás un correo con los resultados en cuanto termine el análisis — normalmente en unas horas.",
    infoTitle: "Cómo funciona a partir de ahora",
    infoDesc: "Las nuevas disputas se sincronizan automáticamente desde Shopify. DisputeDesk crea el paquete de evidencia y lo guarda en tu disputa en el Admin de Shopify. Tú revisas el paquete allí y lo envías a la red de tarjetas cuando estés listo.",
  },
  "fr.json": {
    analysisTitle: "Nous analysons votre historique de commandes",
    analysisDesc: "DisputeDesk examine vos commandes Shopify passées pour créer un aperçu des risques de votre boutique. Vous recevrez un e-mail avec les résultats dès la fin de l'analyse — généralement en quelques heures.",
    infoTitle: "Comment ça marche à partir de maintenant",
    infoDesc: "Les nouveaux litiges se synchronisent automatiquement depuis Shopify. DisputeDesk crée le dossier de preuves et l'enregistre dans votre litige dans l'Admin Shopify. Vous examinez le dossier là-bas et le soumettez au réseau de cartes quand vous êtes prêt.",
  },
  "fr-FR.json": {
    analysisTitle: "Nous analysons votre historique de commandes",
    analysisDesc: "DisputeDesk examine vos commandes Shopify passées pour créer un aperçu des risques de votre boutique. Vous recevrez un e-mail avec les résultats dès la fin de l'analyse — généralement en quelques heures.",
    infoTitle: "Comment ça marche à partir de maintenant",
    infoDesc: "Les nouveaux litiges se synchronisent automatiquement depuis Shopify. DisputeDesk crée le dossier de preuves et l'enregistre dans votre litige dans l'Admin Shopify. Vous examinez le dossier là-bas et le soumettez au réseau de cartes quand vous êtes prêt.",
  },
  "pt.json": {
    analysisTitle: "Estamos analisando seus pedidos históricos",
    analysisDesc: "O DisputeDesk está revisando seus pedidos anteriores do Shopify para criar um panorama de risco da sua loja. Você receberá um e-mail com os resultados assim que a análise terminar — normalmente em algumas horas.",
    infoTitle: "Como funciona a partir de agora",
    infoDesc: "Novas disputas são sincronizadas automaticamente do Shopify. O DisputeDesk monta o pacote de evidências e salva no seu caso de disputa no Admin do Shopify. Você revisa o pacote lá e envia para a rede de cartões quando estiver pronto.",
  },
  "pt-BR.json": {
    analysisTitle: "Estamos analisando seus pedidos históricos",
    analysisDesc: "O DisputeDesk está revisando seus pedidos anteriores do Shopify para criar um panorama de risco da sua loja. Você receberá um e-mail com os resultados assim que a análise terminar — normalmente em algumas horas.",
    infoTitle: "Como funciona a partir de agora",
    infoDesc: "Novas disputas são sincronizadas automaticamente do Shopify. O DisputeDesk monta o pacote de evidências e salva no seu caso de disputa no Admin do Shopify. Você revisa o pacote lá e envia para a rede de cartões quando estiver pronto.",
  },
  "sv.json": {
    analysisTitle: "Vi analyserar dina tidigare beställningar",
    analysisDesc: "DisputeDesk granskar dina tidigare Shopify-beställningar för att skapa en risköversikt för din butik. Du får ett mejl med resultatet så snart analysen är klar — vanligtvis inom några timmar.",
    infoTitle: "Så fungerar det härifrån",
    infoDesc: "Nya tvister synkas automatiskt från Shopify. DisputeDesk bygger bevispaketet och sparar det tillbaka i din tvist i Shopify Admin. Du granskar paketet där och skickar in det till kortnätverket när du är redo.",
  },
  "sv-SE.json": {
    analysisTitle: "Vi analyserar dina tidigare beställningar",
    analysisDesc: "DisputeDesk granskar dina tidigare Shopify-beställningar för att skapa en risköversikt för din butik. Du får ett mejl med resultatet så snart analysen är klar — vanligtvis inom några timmar.",
    infoTitle: "Så fungerar det härifrån",
    infoDesc: "Nya tvister synkas automatiskt från Shopify. DisputeDesk bygger bevispaketet och sparar det tillbaka i din tvist i Shopify Admin. Du granskar paketet där och skickar in det till kortnätverket när du är redo.",
  },
};

const files = fs.readdirSync(messagesDir).filter((f) => f.endsWith(".json"));

for (const file of files) {
  const full = path.join(messagesDir, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  const complete = json.setup?.complete;
  const copy = COPY[file];
  if (!complete || !copy) {
    console.warn(`! ${file}: no setup.complete or no copy mapping, skipping`);
    continue;
  }
  for (const [k, v] of Object.entries(copy)) {
    complete[k] = v;
  }
  fs.writeFileSync(full, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`✓ ${file}: updated ${Object.keys(copy).length} keys`);
}
