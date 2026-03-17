import { buildColdStartPrompt, buildIterativePrompt } from '@/lib/prompts';
import { scorePlan } from '@/lib/damageModel';

export const maxDuration = 120;

export async function POST(request) {
  const scenario = await request.json();
  const apiKey = process.env.OPENROUTER_API_KEY;

  console.log('[SIMULATE] Starting simulation for', scenario.county, 'County');

  if (!apiKey) {
    console.error('[SIMULATE] No OPENROUTER_API_KEY set');
    return new Response(JSON.stringify({ error: 'OpenRouter API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let controllerClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data) {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        } catch (e) {
          console.warn('[SIMULATE] Send failed (controller closed):', e.message);
          controllerClosed = true;
        }
      }

      let bestPlan = null;
      let bestScore = -Infinity;
      const history = [];
      const totalRounds = 1;

      try {
        for (let round = 0; round < totalRounds; round++) {
          if (controllerClosed) break;

          console.log(`[SIMULATE] === Round ${round + 1}/${totalRounds} ===`);
          send({ type: 'round_start', round, total: totalRounds });

          const prompt = round === 0
            ? buildColdStartPrompt(scenario)
            : buildIterativePrompt(scenario, bestPlan, bestScore, history);

          console.log(`[SIMULATE] Prompt length: ${prompt.length} chars`);

          let plans = [];
          try {
            plans = await callNemotron(apiKey, prompt, round);
            console.log(`[SIMULATE] Round ${round + 1}: Got ${plans.length} plans`);
          } catch (err) {
            console.error(`[SIMULATE] Round ${round + 1} FAILED:`, err.message);
            send({ type: 'error', round, message: err.message });
            continue;
          }

          if (!Array.isArray(plans) || plans.length === 0) {
            console.warn(`[SIMULATE] Round ${round + 1}: No valid plans`);
            send({ type: 'error', round, message: 'No valid plans returned' });
            continue;
          }

          for (let i = 0; i < plans.length; i++) {
            const plan = plans[i];
            const score = scorePlan(plan, scenario);

            console.log(`[SIMULATE] R${round + 1} P${i + 1}: "${plan.strategy_name}" → ${score}`);

            history.push({
              round,
              plan_id: plan.plan_id || i + 1,
              strategy: plan.strategy_name || `Plan ${i + 1}`,
              score,
            });

            if (score > bestScore) {
              bestScore = score;
              bestPlan = plan;
              console.log(`[SIMULATE] ★ New best: ${score}`);
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
        }

        console.log(`[SIMULATE] DONE. Best: ${bestScore}, Total plans: ${history.length}`);

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

      if (!controllerClosed) {
        controllerClosed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}

async function callNemotron(apiKey, prompt, round, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    console.log(`[AI] Round ${round + 1}, attempt ${attempt + 1}/${retries + 1}...`);

    const body = {
      model: 'nvidia/nemotron-nano-12b-v2-vl:free',
      messages: [
        {
          role: 'system',
          content: 'You are a disaster recovery planning AI. You output ONLY valid JSON arrays of recovery plans. No markdown, no explanations, no code blocks. Just the raw JSON array. Keep responses concise — short descriptions, no extra fields.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 4000,
    };

    console.log(`[AI] Request size: ${JSON.stringify(body).length} bytes`);

    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wildfire-recovery-sim.vercel.app',
          'X-Title': 'Wildfire Recovery Simulator',
        },
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      console.error(`[AI] Fetch error:`, fetchErr.message);
      if (attempt < retries) {
        console.log(`[AI] Retrying in 2s...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw fetchErr;
    }

    console.log(`[AI] Status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[AI] Error body:`, errText.slice(0, 500));

      // Rate limited — wait and retry
      if (res.status === 429 && attempt < retries) {
        console.log(`[AI] Rate limited, waiting 5s...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 300)}`);
    }

    const rawText = await res.text();
    console.log(`[AI] Raw response length: ${rawText.length} chars`);
    console.log(`[AI] Raw response preview: ${rawText.slice(0, 300)}`);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error(`[AI] Failed to parse response as JSON:`, rawText.slice(0, 500));
      if (attempt < retries) {
        console.log(`[AI] Retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw new Error('Response is not valid JSON');
    }

    // Check for API-level errors
    if (data.error) {
      console.error(`[AI] API error:`, JSON.stringify(data.error));
      if (attempt < retries) {
        console.log(`[AI] Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    console.log(`[AI] Model: ${data.model || 'unknown'}, Usage: ${JSON.stringify(data.usage || {})}`);

    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log(`[AI] Finish reason: ${finishReason}`);

    if (!content) {
      console.error(`[AI] No content in response. choices:`, JSON.stringify(data.choices || []));
      if (attempt < retries) {
        console.log(`[AI] Empty response, retrying in 3s...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw new Error('Empty response from AI (no content after retries)');
    }

    console.log(`[AI] Content (${content.length} chars): ${content.slice(0, 200)}...`);

    try {
      return parseJsonResponse(content);
    } catch (parseErr) {
      console.error(`[AI] Parse error:`, parseErr.message);
      if (attempt < retries) {
        console.log(`[AI] Parse failed, retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw parseErr;
    }
  }
}

function parseJsonResponse(content) {
  let jsonStr = content.trim();

  // Strip markdown code blocks
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const result = Array.isArray(parsed) ? parsed : [parsed];
    console.log(`[PARSE] OK: ${result.length} plans`);
    return result;
  } catch (e) {
    // noop
  }

  const match = jsonStr.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const result = JSON.parse(match[0]);
      console.log(`[PARSE] Array extracted: ${result.length} plans`);
      return result;
    } catch (e) {
      // noop
    }
  }

  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const result = [JSON.parse(objMatch[0])];
      console.log(`[PARSE] Object extracted`);
      return result;
    } catch (e) {
      // noop
    }
  }

  console.error(`[PARSE] FAILED. Content:\n${jsonStr.slice(0, 1000)}`);
  throw new Error('Could not parse AI response: ' + jsonStr.slice(0, 200));
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
