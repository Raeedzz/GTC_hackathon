import { buildColdStartPrompt, buildIterativePrompt } from '@/lib/prompts';
import { scorePlan } from '@/lib/damageModel';

export const maxDuration = 120;

export async function POST(request) {
  const scenario = await request.json();
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('[SIMULATE] Starting simulation for', scenario.county, 'County');
  console.log('[SIMULATE] Damage report:', JSON.stringify(scenario.damage, null, 2).slice(0, 500));

  if (!apiKey) {
    console.error('[SIMULATE] No OPENROUTER_API_KEY set');
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('[SIMULATE] API key present, length:', apiKey.length);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      }

      let bestPlan = null;
      let bestScore = -Infinity;
      const history = [];
      const totalRounds = 10;

      try {
        for (let round = 0; round < totalRounds; round++) {
          console.log(`[SIMULATE] === Round ${round + 1}/${totalRounds} ===`);
          send({ type: 'round_start', round, total: totalRounds });

          const prompt = round === 0
            ? buildColdStartPrompt(scenario)
            : buildIterativePrompt(scenario, bestPlan, bestScore, history);

          console.log(`[SIMULATE] Prompt length: ${prompt.length} chars`);

          let plans = [];
          try {
            const startTime = Date.now();
            plans = await callNemotron(apiKey, prompt, round);
            console.log(`[SIMULATE] Round ${round + 1}: Got ${plans.length} plans in ${Date.now() - startTime}ms`);
          } catch (err) {
            console.error(`[SIMULATE] Round ${round + 1} FAILED:`, err.message);
            send({ type: 'error', round, message: 'AI call failed: ' + err.message });
            continue;
          }

          if (!Array.isArray(plans) || plans.length === 0) {
            console.warn(`[SIMULATE] Round ${round + 1}: No valid plans returned`);
            send({ type: 'error', round, message: 'No valid plans returned' });
            continue;
          }

          for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const score = scorePlan(plan, scenario);

            console.log(`[SIMULATE] Round ${round + 1} Plan ${i + 1}: "${plan.strategy_name}" → score ${score}`);

            history.push({
              round,
              plan_id: plan.plan_id || i + 1,
              strategy: plan.strategy_name || `Plan ${i + 1}`,
              score,
            });

            if (score > bestScore) {
              bestScore = score;
              bestPlan = plan;
              console.log(`[SIMULATE] ★ New best! Score: ${score}, Strategy: "${plan.strategy_name}"`);
            }

            send({
              type: 'plan_evaluated',
              round,
              plan_index: i,
              plan_name: plan.strategy_name || `Plan ${i + 1}`,
              score,
              best_so_far: bestScore,
            });
          }

          send({
            type: 'round_complete',
            round,
            best_score: bestScore,
            best_strategy: bestPlan?.strategy_name || 'Unknown',
            plans_evaluated: history.length,
          });

          console.log(`[SIMULATE] Round ${round + 1} complete. Best so far: ${bestScore}`);
        }

        console.log(`[SIMULATE] === DONE === Best score: ${bestScore}, Plans evaluated: ${history.length}`);
        console.log(`[SIMULATE] Winning strategy: "${bestPlan?.strategy_name}"`);

        send({
          type: 'complete',
          optimal_plan: bestPlan,
          best_score: bestScore,
          total_plans_evaluated: history.length,
          history,
          improvement_curve: buildImprovementCurve(history, totalRounds),
        });
      } catch (err) {
        console.error('[SIMULATE] Fatal error:', err);
        send({ type: 'fatal_error', message: err.message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}

async function callNemotron(apiKey, prompt, round) {
  console.log(`[AI] Calling OpenRouter (round ${round + 1})...`);

  const body = {
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    messages: [
      {
        role: 'system',
        content: 'You are a disaster recovery planning AI. You output ONLY valid JSON arrays of recovery plans. No markdown, no explanations, no code blocks. Just the raw JSON array.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 4000,
  };

  console.log(`[AI] Request body size: ${JSON.stringify(body).length} bytes`);

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wildfire-recovery-sim.vercel.app',
      'X-Title': 'Wildfire Recovery Simulator',
    },
    body: JSON.stringify(body),
  });

  console.log(`[AI] Response status: ${res.status}`);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[AI] Error response:`, errText.slice(0, 500));
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();

  console.log(`[AI] Response model: ${data.model || 'unknown'}`);
  console.log(`[AI] Usage: ${JSON.stringify(data.usage || {})}`);

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    console.error(`[AI] Empty content. Full response:`, JSON.stringify(data).slice(0, 500));
    throw new Error('Empty response from AI');
  }

  console.log(`[AI] Content length: ${content.length} chars`);
  console.log(`[AI] Content preview: ${content.slice(0, 200)}...`);

  return parseJsonResponse(content);
}

function parseJsonResponse(content) {
  let jsonStr = content.trim();

  // Strip markdown code blocks
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try direct parse
  try {
    const parsed = JSON.parse(jsonStr);
    const result = Array.isArray(parsed) ? parsed : [parsed];
    console.log(`[PARSE] Direct parse OK, ${result.length} plans`);
    return result;
  } catch (e) {
    console.warn(`[PARSE] Direct parse failed: ${e.message}`);
  }

  // Try to extract JSON array from response
  const match = jsonStr.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const result = JSON.parse(match[0]);
      console.log(`[PARSE] Array extraction OK, ${result.length} plans`);
      return result;
    } catch (e) {
      console.warn(`[PARSE] Array extraction failed: ${e.message}`);
    }
  }

  // Try to extract single JSON object
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const result = [JSON.parse(objMatch[0])];
      console.log(`[PARSE] Object extraction OK`);
      return result;
    } catch (e) {
      console.warn(`[PARSE] Object extraction failed: ${e.message}`);
    }
  }

  console.error(`[PARSE] All parsing failed. Raw content:\n${jsonStr.slice(0, 1000)}`);
  throw new Error('Could not parse AI response as JSON: ' + jsonStr.slice(0, 200));
}

function buildImprovementCurve(history, totalRounds) {
  const curve = [];
  for (let r = 0; r < totalRounds; r++) {
    const roundPlans = history.filter(h => h.round === r);
    if (roundPlans.length === 0) continue;
    const bestInRound = Math.max(...roundPlans.map(p => p.score));
    curve.push({ round: r, best_score: bestInRound });
  }
  return curve;
}
