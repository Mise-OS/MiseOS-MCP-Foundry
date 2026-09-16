import {
  getCharacterCard,
  listCharacterCards,
  renderCharacterSystemPrompt,
} from "./character-cards.mjs";
import {
  OpenRouterFreeClient,
  buildDeveloperMessages,
} from "./openrouter-client.mjs";
import { CardTeamOrchestrator, DEFAULT_CARD_TEAM } from "./card-teams.mjs";

function publicCard(card) {
  const { systemPrompt, ...rest } = card;
  return rest;
}

export function createDeveloperBot({ client = new OpenRouterFreeClient(), teamOptions = {} } = {}) {
  const bot = {
    listCards() {
      return {
        schema: "miseos.character-card.list.v1",
        cards: listCharacterCards(),
        defaultTeam: [...DEFAULT_CARD_TEAM],
      };
    },

    getCard(id) {
      const card = getCharacterCard(id);
      return {
        schema: "miseos.character-card.v1",
        card: publicCard(card),
        systemPrompt: renderCharacterSystemPrompt(card),
      };
    },

    async chat({ cardId = "mise-maestro", prompt, context = null, model } = {}) {
      const card = getCharacterCard(cardId);
      const messages = buildDeveloperMessages({
        characterPrompt: renderCharacterSystemPrompt(card),
        prompt,
        context,
      });
      const completion = await client.chat({
        messages,
        model,
        temperature: card.temperature,
      });

      return {
        schema: "miseos.developer-bot.response.v1",
        card: publicCard(card),
        answer: completion.text,
        requestedModel: completion.requestedModel,
        servedModel: completion.model,
        usage: completion.usage,
        openRouterRequestId: completion.id,
        authority: "advisory",
        writeAuthority: "none",
        freeOnly: true,
        nextAction:
          "If this answer proposes a repository mutation, send the proposed action through the MiseOS capability gateway; writes still require the existing human approval path.",
      };
    },
  };

  const team = new CardTeamOrchestrator({ bot, ...teamOptions });
  bot.runTeam = (args) => team.run(args);
  return bot;
}
