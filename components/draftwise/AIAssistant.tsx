"use client";

import { useState } from "react";
import { Sparkles, X, Send, HelpCircle, Bot, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/draftwise/utilities/Toast";

interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AIAssistantProps {
  draftContent?: string;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function AIAssistant({ 
  draftContent = "", 
  isOpen = true,
  onToggle 
}: AIAssistantProps) {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "I'm your writing assistant! I can help you with:\n\n• Improving clarity and flow\n• Suggesting word choices\n• Checking grammar and style\n• Providing feedback on tone\n\nWhat would you like help with?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const suggestedQuestions = [
    "How can I make this more concise?",
    "Is the tone appropriate?",
    "Are there any grammar issues?",
    "Suggest better word choices"
  ];

  async function handleSend() {
    if (!input.trim()) return;

    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);

    // Simulate AI processing (in production, this would call your AI provider)
    setTimeout(() => {
      const response: AIMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: generateResponse(input, draftContent),
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, response]);
      setIsProcessing(false);
    }, 1000);
  }

  function generateResponse(userInput: string, content: string): string {
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes("concise") || lowerInput.includes("short")) {
      return "To make your writing more concise:\n\n1. Remove unnecessary words like 'very', 'really', 'quite'\n2. Use active voice instead of passive\n3. Combine short, choppy sentences\n4. Replace phrases with single words where possible\n\nExample:\nBefore: 'In order to' → After: 'To'\nBefore: 'due to the fact that' → After: 'because'\n\nWould you like me to analyze your current draft?";
    }
    
    if (lowerInput.includes("tone") || lowerInput.includes("formal") || lowerInput.includes("professional")) {
      return "Your tone can be adjusted based on your audience:\n\n**Professional/Formal:**\n- Use complete sentences\n- Avoid contractions (don't, can't)\n- Choose precise vocabulary\n\n**Casual/Friendly:**\n- Use contractions naturally\n- Include personal pronouns\n- Keep sentences shorter\n\n**Academic:**\n- Maintain objectivity\n- Use discipline-specific terminology\n- Support claims with evidence\n\nWhat tone are you aiming for?";
    }
    
    if (lowerInput.includes("grammar") || lowerInput.includes("spell")) {
      return "Common grammar improvements:\n\n✓ **Subject-verb agreement**: Ensure subjects match their verbs\n✓ **Comma usage**: Use before conjunctions joining independent clauses\n✓ **A/an**: 'a' before consonants, 'an' before vowels\n✓ **Passive vs Active**: Prefer active voice for clarity\n✓ **Word choice**: Watch out for commonly confused words (their/there/they're)\n\nWant me to review specific text?";
    }
    
    if (lowerInput.includes("help") || lowerInput.includes("what")) {
      return "I can help you with many writing tasks:\n\n📝 **Content Analysis**: Review your draft for clarity, flow, and engagement\n✍️ **Style Suggestions**: Offer alternatives for repetitive or weak phrasing\n🎯 **Audience Adaptation**: Help tailor tone to your intended readers\n⚡ **Efficiency**: Condense verbose passages without losing meaning\n✅ **Quality Check**: Spot common errors and improvement opportunities\n\nJust type your question or paste text for analysis!";
    }
    
    return "Thanks for your message! Here's my suggestion:\n\nBased on your query, consider these improvements:\n\n• Be more specific in your descriptions\n• Vary sentence structure for readability\n• Use strong verbs instead of adverbs\n• Add concrete examples where abstract\n\nIs there something specific you'd like to improve?";
  }

  function handleSuggestion(question: string) {
    setInput(question);
  }

  function toggleCollapse() {
    setIsCollapsed(!isCollapsed);
  }

  return (
    <div className={`bg-card border rounded-lg overflow-hidden flex flex-col ${isOpen ? 'h-[500px]' : 'h-10'} transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-primary/10 to-secondary">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <Bot size={16} className="text-primary-foreground" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">AI Writing Assistant</h3>
            <p className="text-xs text-muted-foreground">Always here to help</p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={toggleCollapse}
            className="p-1 hover:bg-secondary rounded transition-colors"
            aria-label={isCollapsed ? "Expand assistant" : "Collapse assistant"}
          >
            {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {onToggle && (
            <button
              onClick={onToggle}
              className="p-1 hover:bg-secondary rounded transition-colors"
              aria-label="Close assistant"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      
      {!isCollapsed && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-foreground'
                  }`}
                >
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                  <div className={`text-xs mt-1 opacity-70 ${msg.role === 'user' ? 'text-right' : ''}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            
            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-secondary p-3 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Sparkles className="animate-pulse" size={14} />
                    <span className="text-sm text-muted-foreground">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Quick suggestions */}
          {messages.length < 3 && (
            <div className="px-4 py-2 border-t flex gap-2 overflow-x-auto">
              {suggestedQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestion(question)}
                  className="whitespace-nowrap px-3 py-1 bg-secondary hover:bg-secondary/80 rounded-full text-xs transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>
          )}
          
          {/* Input */}
          <div className="p-3 border-t">
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask for writing help..."
                disabled={isProcessing}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isProcessing}
                size="icon"
              >
                <Send size={16} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <HelpCircle size={10} className="inline mr-1" />
              Your conversations are private and never stored
            </p>
          </div>
        </>
      )}
    </div>
  );
}
