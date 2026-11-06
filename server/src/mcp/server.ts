// MCP view of the marketplace: the same tool registry as the in-app assistants, plus read-only resources and prompts.
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, type CallToolResult, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SERVER_VERSION } from '../config.js';
import * as store from '../marketplace/store.js';
import { executeTool, toolsForActor, ToolError } from '../marketplace/tools.js';
import type { Actor } from '../marketplace/types.js';

/** JSON-RPC error code the MCP spec uses for an unknown resource. */
const RESOURCE_NOT_FOUND = -32002;

function instructionsFor(actor: Actor): string {
  if (actor.role === 'buyer') {
    return (
      `Open Marketplace, an Amazon-style marketplace. You are acting for ${actor.name} (buyer). ` +
      'Find products with search_products (price filters are US dollars; results carry cents plus formatted prices), ' +
      'inspect them with get_product, manage the cart with add_to_cart / remove_from_cart / view_cart, and track ' +
      'orders with list_orders / get_order. Only call checkout or cancel_order when the user explicitly asks for it ' +
      'or confirms. Checkout creates one order per seller. Resources: marketplace://products, ' +
      'marketplace://products/{id}, marketplace://orders.'
    );
  }
  return (
    `Open Marketplace, an Amazon-style marketplace. You are acting for ${actor.name} (seller). ` +
    'Manage listings with list_my_listings / create_listing / update_listing (prices in US dollars; stock is the ' +
    'absolute number of units), fulfil orders with get_seller_orders and update_order_status (placed → shipped → ' +
    'delivered), and check performance with seller_stats. Confirm with the user before publishing a listing or ' +
    'changing an order. Resources: marketplace://products, marketplace://products/{id}, marketplace://orders.'
  );
}

function json(uri: string, value: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
}

/** A fresh server per request (stateless transport); the actor's scope decides which tools exist. */
export function createMcpServer(actor: Actor): McpServer {
  const server = new McpServer(
    { name: 'open-marketplace', title: 'Open Marketplace', version: SERVER_VERSION },
    { instructions: instructionsFor(actor) },
  );

  for (const tool of toolsForActor(actor)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly === true,
          ...(tool.readOnly ? {} : { destructiveHint: !tool.additive }),
          openWorldHint: false,
        },
      },
      async (args): Promise<CallToolResult> => {
        try {
          const output = executeTool(actor, tool.name, args, 'mcp');
          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output as Record<string, unknown>,
          };
        } catch (err) {
          if (err instanceof ToolError) return { isError: true, content: [{ type: 'text', text: err.message }] };
          throw err;
        }
      },
    );
  }

  server.registerResource(
    'products',
    'marketplace://products',
    {
      title: 'Active products',
      description: 'Every active product in the marketplace as ProductSummary JSON ({ products, total }).',
      mimeType: 'application/json',
    },
    async (uri) => {
      const products = store.listActiveProducts();
      return json(uri.href, { products, total: products.length });
    },
  );

  server.registerResource(
    'product',
    new ResourceTemplate('marketplace://products/{id}', {
      list: async () => ({
        resources: store.listActiveProducts().map((p) => ({
          uri: `marketplace://products/${p.id}`,
          name: p.id,
          title: `${p.emoji} ${p.title}`,
          description: `${p.price} · ${p.category} · ${p.seller_name}`,
          mimeType: 'application/json',
        })),
      }),
      complete: {
        id: (value) =>
          store
            .listActiveProducts()
            .map((p) => p.id)
            .filter((id) => id.startsWith(value))
            .slice(0, 20),
      },
    }),
    {
      title: 'Product details',
      description: 'Full ProductDetail JSON ({ product }) for one active product, e.g. marketplace://products/prod_ab12cd34.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const raw = variables.id;
      const id = decodeURIComponent(String(Array.isArray(raw) ? raw[0] : raw ?? ''));
      try {
        return json(uri.href, { product: store.getProduct(id) });
      } catch (err) {
        if (err instanceof ToolError) throw new McpError(RESOURCE_NOT_FOUND, err.message, { uri: uri.href });
        throw err;
      }
    },
  );

  server.registerResource(
    'orders',
    'marketplace://orders',
    {
      title: actor.role === 'buyer' ? 'My orders' : 'Store orders',
      description:
        actor.role === 'buyer'
          ? `Orders placed by ${actor.name}, newest first ({ orders }).`
          : `Orders placed with ${actor.name}, newest first ({ orders }).`,
      mimeType: 'application/json',
    },
    async (uri) =>
      json(uri.href, {
        orders: actor.role === 'buyer' ? store.listBuyerOrders(actor.id) : store.listSellerOrders(actor.id),
      }),
  );

  if (actor.role === 'buyer') {
    server.registerPrompt(
      'shopping_assistant',
      {
        title: 'Shopping assistant',
        description: 'Find, compare and recommend marketplace products for a need, asking before anything is bought.',
        argsSchema: {
          need: z.string().describe('What you are shopping for, e.g. "a gift under $50 for a coffee lover".'),
        },
      },
      ({ need }) => ({
        description: 'Shop the Open Marketplace for a specific need',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Help me shop on Open Marketplace. What I need: ${need}\n\n` +
                'Use search_products (try a couple of keyword variations and use max_price / category / sort filters ' +
                'for constraints), look closer at promising items with get_product, then recommend the best 2-3 ' +
                'options with a one-line reason each (price, rating, stock, seller). Ask me before adding anything to ' +
                'the cart, and never check out unless I explicitly say so.',
            },
          },
        ],
      }),
    );
  } else {
    server.registerPrompt(
      'seller_briefing',
      {
        title: 'Seller briefing',
        description: "A quick briefing on the store: revenue, orders to ship, low stock and best sellers, with a to-do list.",
      },
      () => ({
        description: `Daily briefing for ${actor.name}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Give me a short briefing on my store (${actor.name}) on Open Marketplace. Call seller_stats, and ` +
                'get_seller_orders with status "placed". Summarize revenue and orders, list the orders waiting to ship ' +
                '(oldest first), flag listings with 5 or fewer units and suggest restock amounts, and name the best ' +
                'sellers. End with a prioritized to-do list of at most 5 items. Do not change anything without asking me.',
            },
          },
        ],
      }),
    );
  }

  return server;
}
