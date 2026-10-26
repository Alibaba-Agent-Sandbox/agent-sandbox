import '../_support/isolatedHome.js';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Context, command} from '../../src/cli/kit.js';
import * as interaction from '../../src/cli/interaction.js';
import * as prompts from '../../src/cli/prompts.js';
import * as index from '../../src/utils/template_index.js';
import * as launch from '../../src/cli/template_launch.js';
import {chooseTemplate, continueSetup} from '../../src/cli/setup.js';
import {useIso} from '../_support/iso.js';

useIso();
afterEach(() => vi.restoreAllMocks());
const ctx = () => new Context(command('init'));
function catalog() {
  vi.spyOn(interaction,'canPrompt').mockReturnValue(true);
  return vi.spyOn(index,'fetchIndex').mockResolvedValue(new index.TemplateIndex({entries:[
    new index.TemplateIndexEntry({name:'opencode',description:'coding agent',repo:'owner/templates',path:'opencode'}),
    new index.TemplateIndexEntry({name:'other-managed',repo:'owner/templates',manifest:{provider:'other-cloud'}}),
  ]}));
}

describe('initialization to creation',()=>{
  it('finds catalog content and hands the selection to the ordinary launch entry',async()=>{
    const fetch=catalog();
    vi.spyOn(prompts,'prompt').mockResolvedValue('coding');
    const answers=['launch','opencode'];
    const choose=vi.spyOn(prompts,'select').mockImplementation(async()=>answers.shift()!);
    const create=vi.spyOn(launch,'launchTemplate').mockResolvedValue(undefined);
    await continueSetup(ctx());
    expect(fetch).toHaveBeenCalledOnce();
    expect(choose.mock.calls[1]![1].choices.map(c=>c.value)).toContain('opencode');
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![1]).toEqual({template_ref:'opencode'});
  });
  it('offers another search when the initial purpose has no match',async()=>{
    catalog();
    vi.spyOn(prompts,'prompt').mockResolvedValueOnce('missing-purpose').mockResolvedValueOnce('');
    const choose=vi.spyOn(prompts,'select').mockResolvedValue('opencode');
    expect(await chooseTemplate(ctx())).toBe('opencode');
    expect(choose.mock.calls[0]![1].choices.some(c=>c.value==='other-managed')).toBe(false);
  });
  it('puts an exact template name ahead of description matches',async()=>{
    const fetch=catalog();
    fetch.mockResolvedValue(new index.TemplateIndex({entries:[
      new index.TemplateIndexEntry({name:'database',description:'base image',repo:'owner/templates'}),
      new index.TemplateIndexEntry({name:'base',repo:'owner/templates'}),
    ]}));
    vi.spyOn(prompts,'prompt').mockResolvedValue('base');
    const choose=vi.spyOn(prompts,'select').mockResolvedValue('base');
    expect(await chooseTemplate(ctx())).toBe('base');
    expect(choose.mock.calls[0]![1].choices[0]!.value).toBe('base');
    expect(choose.mock.calls[0]![1].default).toBe('base');
  });
  it('finishes configuration without fetching or creating if no continuation is selected',async()=>{
    const fetch=catalog();
    vi.spyOn(prompts,'select').mockResolvedValue('');
    const create=vi.spyOn(launch,'launchTemplate').mockResolvedValue(undefined);
    await continueSetup(ctx());
    expect(fetch).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
  });
  it('does not ask questions or fetch the catalog in automation',async()=>{
    vi.spyOn(interaction,'canPrompt').mockReturnValue(false);
    const ask=vi.spyOn(prompts,'select');const fetch=vi.spyOn(index,'fetchIndex');
    await continueSetup(ctx());
    await expect(chooseTemplate(ctx())).rejects.toThrow('supply NAME and --yes');
    expect(ask).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
});
