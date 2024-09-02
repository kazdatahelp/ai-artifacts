'use client'

import { useEffect, useState } from 'react'
import { experimental_useObject as useObject } from 'ai/react'
import { useLocalStorage } from 'usehooks-ts'
import { usePostHog } from 'posthog-js/react'
import { ArtifactSchema, artifactSchema as schema } from '@/lib/schema'

import { Chat } from '@/components/chat'
import { SideView } from '@/components/side-view'
import NavBar from '@/components/navbar'

import { supabase } from '@/lib/supabase'
import { AuthDialog } from '@/components/AuthDialog'
import { useAuth } from '@/lib/auth'

import { LLMModel, LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import templates, { TemplateId } from '@/lib/templates';

import { ExecutionResult } from './api/sandbox/route';
import { CoreMessage } from 'ai'

export type Message = {
  // id: string
  role: 'user' | 'assistant'
  content: string
  commentary?: string
  meta?: {
    title?: string
    description?: string
  }
}

function toAISDKMessages(messages: Message[]): CoreMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: message.content,
  }))
}

export default function Home() {
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [selectedTemplate, setSelectedTemplate] = useState<'auto' | TemplateId>('auto')
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>('languageModel', {
    model: 'claude-3-5-sonnet-20240620'
  })

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [artifact, setArtifact] = useState<Partial<ArtifactSchema> | undefined>()
  const [currentTab, setCurrentTab] = useState<'code' | 'artifact'>('code')

  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const { session, apiKey } = useAuth(setAuthDialog)

  const currentModel = modelsList.models.find(model => model.id === languageModel.model)
  const currentTemplate = selectedTemplate === 'auto' ? templates : { [selectedTemplate]: templates[selectedTemplate] }

  const { object, submit, isLoading, stop, error } = useObject({
    api: '/api/chat',
    schema,
    onFinish: async ({ object: artifact, error }) => {
      if (!error) {
        // send it to /api/sandbox
        console.log('artifact', artifact)

        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            artifact,
            userID: session?.user?.id,
            apiKey
          })
        })

        const result = await response.json()
        console.log('result', result)
        setResult(result)
        setCurrentTab('artifact')
      }
    }
  })

  useEffect(() => {
    if (object) {
      setArtifact(object as ArtifactSchema)
      const lastAssistantMessage = messages.findLast(message => message.role === 'assistant')
      if (lastAssistantMessage) {
        lastAssistantMessage.commentary = object.commentary || ''
        lastAssistantMessage.content = object.code || ''
        lastAssistantMessage.meta = {
          title: object.title,
          description: object.description
        }
      }
    }
  }, [object])

  async function handleSubmitAuth (e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!session) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }

    const updatedMessages = addMessage({
      role: 'user',
      content: chatInput,
    })

    submit({
      userID: session?.user?.id,
      messages: toAISDKMessages(updatedMessages),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
    })

    addMessage({
      role: 'assistant',
      content: '',
      commentary: 'Generating artifact...',
    })

    setChatInput('')
    setCurrentTab('code')

    posthog.capture('chat_submit', {
      template: selectedTemplate,
      model: languageModel.model,
    })
  }

  function addMessage (message: Message) {
    setMessages(previousMessages => [...previousMessages, message])
    return [...messages, message]
  }

  function handleSaveInputChange (e: React.ChangeEvent<HTMLInputElement>) {
    setChatInput(e.target.value)
  }

  function logout () {
    supabase ? supabase.auth.signOut() : console.warn('Supabase is not initialized')
  }

  function handleLanguageModelChange (e: LLMModelConfig) {
    setLanguageModel({ ...languageModel, ...e })
  }

  function handleGitHubClick () {
    window.open('https://github.com/e2b-dev/ai-artifacts', '_blank')
    posthog.capture('github_click')
  }

  return (
    <main className="flex min-h-screen max-h-screen">
      {
        supabase && <AuthDialog open={isAuthDialogOpen} setOpen={setAuthDialog} supabase={supabase} />
      }
      <NavBar
        session={session}
        showLogin={() => setAuthDialog(true)}
        signOut={logout}
        templates={templates}
        selectedTemplate={selectedTemplate}
        onSelectedTemplateChange={setSelectedTemplate}
        models={modelsList.models}
        languageModel={languageModel}
        onLanguageModelChange={handleLanguageModelChange}
        onGitHubClick={handleGitHubClick}
        apiKeyConfigurable={!process.env.NEXT_PUBLIC_USE_HOSTED_MODELS}
        baseURLConfigurable={!process.env.NEXT_PUBLIC_USE_HOSTED_MODELS}
      />

      <div className="flex-1 flex space-x-8 w-full pt-36 pb-8 px-4">
        <Chat
          isLoading={isLoading}
          stop={stop}
          messages={messages}
          input={chatInput}
          handleInputChange={handleSaveInputChange}
          handleSubmit={handleSubmitAuth}
        />
        <SideView
          selectedTab={currentTab}
          onSelectedTabChange={setCurrentTab}
          isLoading={isLoading}
          artifact={artifact as ArtifactSchema}
          result={result}
          selectedTemplate={artifact?.template as TemplateId}
        />
      </div>
    </main>
  )
}
