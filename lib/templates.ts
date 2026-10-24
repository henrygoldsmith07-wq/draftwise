/**
 * Smart Template Library for common document types
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  category: 'professional' | 'academic' | 'creative' | 'personal' | 'business';
  content: string;
  variables: TemplateVariable[];
  previewImage?: string;
}

export interface TemplateVariable {
  name: string;
  placeholder: string;
  description?: string;
  type: 'text' | 'date' | 'select';
  options?: string[];
}

const TEMPLATES: Template[] = [
  {
    id: 'resume',
    name: 'Professional Resume',
    description: 'Clean, ATS-friendly resume template',
    category: 'professional',
    content: `# ${'{{FULL_NAME}}'}
Position Seeking: {{TARGET_POSITION}}
Contact: {{EMAIL}} | {{PHONE}} | {{LOCATION}}

## PROFESSIONAL SUMMARY
{{2-3 sentence summary of your career goals and strengths}}

## EXPERIENCE

### {{JOB_TITLE}} | {{COMPANY_NAME}}
{{START_DATE}} - {{END_DATE}}
{{CITY, STATE}}

- {{ACHIEVEMENT_1_with_quantifiable_result}}
- {{ACHIEVEMENT_2}}
- {{ACHIEVEMENT_3}}

**Key Skills:** {{SKILL_1}}, {{SKILL_2}}, {{SKILL_3}}

### {{JOB_TITLE}} | {{COMPANY_NAME}}
{{START_DATE}} - {{END_DATE}}

- Led {{PROJECT_DESCRIPTION}} resulting in {{RESULT}}
- Improved {{METRIC}} by {{PERCENTAGE}}%
- Managed team of {{NUMBER}} people

## EDUCATION

{{DEGREE}} in {{MAJOR}}
{{UNIVERSITY_NAME}}, {{LOCATION}}
{{GRADUATION_DATE}}

## SKILLS & CERTIFICATIONS
- {{TECHNICAL_SKILLS}}
- {{CERTIFICATION_1}}
- {{CERTIFICATION_2}}`,
    variables: [
      { name: 'FULL_NAME', placeholder: 'John Michael Smith', type: 'text' },
      { name: 'TARGET_POSITION', placeholder: 'Senior Software Engineer', type: 'text' },
      { name: 'EMAIL', placeholder: 'john@email.com', type: 'text' },
      { name: 'PHONE', placeholder: '(555) 123-4567', type: 'text' },
      { name: 'LOCATION', placeholder: 'San Francisco, CA', type: 'text' }
    ]
  },
  
  {
    id: 'cover-letter',
    name: 'Professional Cover Letter',
    description: 'Formal cover letter template',
    category: 'professional',
    content: `{{YOUR_NAME}}
{{YOUR_ADDRESS}}
{{YOUR_CITY_STATE_ZIP}}
{{YOUR_EMAIL}}
{{YOUR_PHONE}}

${'{{DATE}}'}

{{RECRUITER_OR_HIRING_MANAGER_NAME}}
{{TITLE}}
{{COMPANY_NAME}}
{{COMPANY_ADDRESS}}
{{COMPANY_CITY_STATE_ZIP}}

Dear ${'{{MR/MRS/MR_S_LAST_NAME}}'},

I am writing to express my strong interest in the {{POSITION_TITLE}} position at {{COMPANY_NAME}}, as advertised on {{JOB_BOARD}}. With my background in {{YOUR_FIELD}} and passion for {{COMPANY_MISSION_OR_VALUE}}, I am confident in my ability to make significant contributions to your team.

During my {{NUMBER}} years of experience at {{CURRENT_COMPANY}}, I have developed expertise in {{KEY_SKILL_1}}, {{KEY_SKILL_2}}, and {{KEY_SKILL_3}}. Most notably, I led a project that resulted in {{QUANTITABLE_ACHIEVEMENT}}, demonstrating my ability to deliver exceptional results.

What particularly excites me about {{COMPANY_NAME}} is your commitment to {{COMPANY_INNOVATION_OR_VALUE}}. My experience in {{RELEVANT_EXPERIENCE}} aligns perfectly with this initiative. For example, I successfully {{SPECIFIC_ACTION}} which produced {{BENEFIT_OR_RESULT}}.

My technical skills include proficiency in {{HARD_SKILL_1}}, {{HARD_SKILL_2}}, and {{HARD_SKILL_3}}. Beyond these qualifications, I bring strong {{SOFT_SKILL_1}} and {{SOFT_SKILL_2}} abilities, making me an effective collaborator and problem-solver.

I would welcome the opportunity to discuss how my background, skills, and enthusiasm can contribute to {{COMPANY_NAME}}'s success. Thank you for considering my application. I look forward to speaking with you soon.

Sincerely,

${'{{YOUR_SIGNATURE}}'}
{{YOUR_FULL_NAME}}`,
    variables: [
      { name: 'POSITION_TITLE', placeholder: 'Senior Marketing Manager', type: 'text' },
      { name: 'COMPANY_NAME', placeholder: 'Tech Innovations Inc.', type: 'text' },
      { name: 'YOUR_FIELD', placeholder: 'digital marketing', type: 'text' }
    ]
  },
  
  {
    id: 'essay-formal',
    name: 'Formal Essay',
    description: 'Academic essay structure',
    category: 'academic',
    content: `# {{ESSAY_TITLE}}

## Introduction
The opening paragraph should hook the reader while introducing the topic of {{TOPIC}}. Begin with an attention-grabbing statement or question, then provide necessary context. End with a clear thesis statement: **{{THESIS_STATEMENT}}**.

## Body Paragraph 1
Topic Sentence: {{MAIN_ARGUMENT_1}}

Evidence: Provide specific examples, research findings, or quotes from credible sources to support this argument. According to {{AUTHOR}} ({{YEAR}}), "{{QUOTE}}".

Analysis: Explain how this evidence supports your main point. Discuss the implications and significance.

Concluding Sentence: Connect back to the thesis and lead into the next paragraph.

## Body Paragraph 2
Topic Sentence: {{MAIN_ARGUMENT_2}}

Evidence: Additional supporting details, preferably from different sources to strengthen your position.

Analysis: Critical evaluation of the evidence. Consider alternative interpretations.

Concluding Sentence: Transition smoothly to the third argument.

## Body Paragraph 3
Topic Sentence: {{MAIN_ARGUMENT_3}}

This paragraph can address counterarguments or present a more nuanced perspective on the topic.

Evidence: Include at least one source that presents a differing view, then explain why your argument remains stronger.

## Counterargument Response
Acknowledge opposing viewpoints: "Critics might argue that..."

Address them directly with reasoning: "However, this overlooks..."

Reaffirm your position with renewed strength.

## Conclusion
Restate Thesis: Rephrase your main argument without simply repeating it.

Summary: Briefly review your key points without going into detail.

Final Thought: Leave readers with a memorable closing statement that connects to broader implications or future considerations regarding {{TOPIC}}.

---

## Works Cited
(Include all sources cited using proper citation format: APA/MLA/Chicago)`
    variables: [
      { name: 'ESSAY_TITLE', placeholder: 'The Impact of Technology on Modern Education', type: 'text' },
      { name: 'TOPIC', placeholder: 'artificial intelligence in healthcare', type: 'text' },
      { name: 'THESIS_STATEMENT', placeholder: 'While AI offers unprecedented diagnostic capabilities, ethical considerations must guide its implementation', type: 'text' }
    ]
  },
  
  {
    id: 'story-narrative',
    name: 'Narrative Story Starter',
    description: 'Creative writing prompt structure',
    category: 'creative',
    content: `## The Beginning

It started on a ${'{{TODAY_S_DATETIME}}'} when everything changed.

{{CHARACTER_NAME}} had always been ordinary. They lived in ${'{{SETTING_LOCATION}}'}, where days blended into each other like watercolor left out in the rain. But today felt different. Today, something extraordinary was about to happen.

"Are you ready?" asked the voice from nowhere and everywhere all at once.

{{Character reacts to the unexpected event}}

## The Middle

The journey took them through:
- {{PLACE_1_description_and_significance}}
- {{PERSON_MET_THEIR}}
- {{OBJECT_FOUND_its_mystery}}

Each challenge taught {{HER/HIM/THEM}} something important:
1. {{LESSON_1_learned}}
2. {{LESSON_2_about_self_or_others}}
3. {{REALIZATION_that_changed_perspective}}

## The Climax

Everything came to a head when {{CLIMACTIC_EVENT_occurred}}. The moment of truth arrived unexpectedly, in the form of {{SURPRISING_CHARACTER_OR_OBJECT}} who revealed that {{THE_TRUTH_BEING_REVEALED}}.

"What choice will you make?" they asked.

## The Resolution

In the end, {{CHARACTER_NAME}} chose {{DECISION_MADE}} because {{REASON_BEHIND_CHOICE}}. Though life would never be the same, there was a newfound sense of {{WHAT_CHARACTER_GAINED_inner_growth}}.

And so, as the sun rose on a new day in ${'{{SETTING_LOCATION}}'}, everything had changed, yet nothing had changed at all.`
    variables: [
      { name: 'CHARACTER_NAME', placeholder: 'Maya Chen', type: 'text' },
      { name: 'SETTING_LOCATION', placeholder: 'a coastal town where fog never fully lifted', type: 'text' },
      { name: 'CLIMACTIC_EVENT', placeholder: 'discovered the door that shouldn\'t exist', type: 'text' }
    ]
  },
  
  {
    id: 'business-proposal',
    name: 'Business Proposal',
    description: 'Formal business proposal framework',
    category: 'business',
    content: `# ${'{{PROJECT_NAME}}'} Proposal

## Executive Summary
${'{{2-3 paragraph overview of the entire proposal, highlighting the main value proposition}}'}

## Problem Statement
**Current Challenge:** {{DESCRIBE_THE_CLIENT_CURRENT_PROBLEM_OR_PAIN_POINT_in_detail}}

**Impact:** This issue results in {{NEGATIVE_OUTCOMES_QUANTIFIED_if_possible}}

**Opportunity:** Addressing this opens the door to {{POSITIVE_OUTCOMES}}

## Proposed Solution

### Overview
We propose to {{SUMMARIZE_YOUR_SOLUTION_clearly_and_concisely}}

### Approach

**Phase 1: Discovery** (${{PHASE_1_DURATION}})
- Objective: {{PHASE_1_GOAL}}
- Deliverables: {{DELIVERABLE_1}}, {{DELIVERABLE_2}}, {{DELIVERABLE_3}}

**Phase 2: Implementation** (${{PHASE_2_DURATION}})
- Key Activities: {{LIST_MAJOR_ACTIVITIES}}
- Milestones: {{IMPORTANT_CHECKPOINTS}}

**Phase 3: Deployment** (${{PHASE_3_DURATION}})
- Rollout Strategy: {{HOW_IT_WILL_BE_IMPLEMENTED}}
- Training & Support: {{TRAINING_REQUIREMENTS}}

### Timeline
| Phase | Start Date | End Date | Duration |
|-------|------------|----------|----------|
| Phase 1 | {{DATE}} | {{DATE}} | {{DAYS}} days |
| Phase 2 | {{DATE}} | {{DATE}} | {{DAYS}} days |
| Phase 3 | {{DATE}} | {{DATE}} | {{DAYS}} days |

**Total Project Duration:** {{TOTAL_DAYS}} business days

## Expected Benefits

### Quantifiable Results
- {{BENEFIT_1_with_metric}}
- {{BENEFIT_2_with_metric}}
- {{BENEFIT_3_with_metric}}

### Strategic Advantages
- {{STRATEGIC_BENEFIT_1}}
- {{STRATEGIC_BENEFIT_2}}
- {{STRATEGIC_BENEFIT_3}}

## Investment Required

### Pricing
| Item | Cost |
|------|------|
| {{SERVICE_OR_PRODUCT_1}} | ${{AMOUNT}} |
| {{SERVICE_OR_PRODUCT_2}} | ${{AMOUNT}} |
| {{SERVICE_OR_PRODUCT_3}} | ${{AMOUNT}} |
| **Total** | **${{TOTAL_AMOUNT}}** |

**Payment Terms:** {{TERMS_CONDITIONS}}

## Why Choose Us

- ✅ {{STRENGTH_OR_DIFFERENTIATOR_1}}
- ✅ {{STRENGTH_OR_DIFFERENTIATOR_2}}
- ✅ {{STRENGTH_OR_DIFFERENTIATOR_3}}
- ✅ {{RELEVANT_CERTIFICATION_OR_ACCOMPLISHMENT}}

## Next Steps

To move forward:
1. Sign this proposal by **${{'{{EXPIRATION_DATE}}'}}**
2. Payment processing begins immediately
3. Kickoff meeting scheduled for **${{'{{KICKOFF_DATE}}'}}**

### Approval

Approved by: ________________________   Date: __________

Name: ______________________________

Title: _____________________________

Company: ___________________________`
    variables: [
      { name: 'PROJECT_NAME', placeholder: 'Digital Transformation Initiative', type: 'text' },
      { name: 'PHASE_1_DURATION', placeholder: '2 weeks', type: 'text' }
    ]
  }
];

/**
 * Get templates by category
 */
export function getTemplatesByCategory(category: Template['category'] | null): Template[] {
  if (!category) return TEMPLATES;
  return TEMPLATES.filter(t => t.category === category);
}

/**
 * Search templates by keyword
 */
export function searchTemplates(query: string): Template[] {
  const lowercaseQuery = query.toLowerCase();
  
  return TEMPLATES.filter(template => 
    template.name.toLowerCase().includes(lowercaseQuery) ||
    template.description.toLowerCase().includes(lowercaseQuery) ||
    template.variables.some(v => v.name.toLowerCase().includes(lowercaseQuery))
  );
}

/**
 * Fill template variables with user-provided values
 */
export function fillTemplateVariables(
  template: Template,
  variableValues: Record<string, string>
): string {
  let content = template.content;
  
  Object.entries(variableValues).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    content = content.replace(regex, value || `{${key}}`);
  });
  
  // Remove any unfilled placeholders with minimal styling
  content = content.replace(/\{\{\s*(\w+)\s*\}\}/g, '[$1]');
  
  return content;
}

/**
 * Extract template metadata for UI
 */
export function getTemplateMetadata(): Array<{
  category: string;
  count: number;
  icon: string;
}> {
  return [
    { category: 'professional', count: TEMPLATES.filter(t => t.category === 'professional').length, icon: '💼' },
    { category: 'academic', count: TEMPLATES.filter(t => t.category === 'academic').length, icon: '🎓' },
    { category: 'creative', count: TEMPLATES.filter(t => t.category === 'creative').length, icon: '✍️' },
    { category: 'business', count: TEMPLATES.filter(t => t.category === 'business').length, icon: '📊' },
    { category: 'personal', count: TEMPLATES.filter(t => t.category === 'personal').length, icon: '📝' }
  ];
}
