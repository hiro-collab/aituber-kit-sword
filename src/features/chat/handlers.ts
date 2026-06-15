import { getAIChatResponseStream } from '@/features/chat/aiChatFactory'
import { Message, EmotionType } from '@/features/messages/messages'
import { speakCharacter } from '@/features/messages/speakCharacter'
import { judgeSlide } from '@/features/slide/slideAIHelpers'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import slideStore from '@/features/stores/slide'
import { goToSlide } from '@/components/slides'
import { messageSelectors } from '../messages/messageSelectors'
import webSocketStore from '@/features/stores/websocketStore'
import i18next from 'i18next'
import toastStore from '@/features/stores/toast'
import { generateMessageId } from '@/utils/messageUtils'
import { isMultiModalAvailable } from '@/features/constants/aiModels'
import {
  saveMessageToMemory,
  searchMemoryContext,
} from '@/features/memory/memoryStoreSync'
import { THINKING_MARKER } from '@/features/chat/vercelAIChat'
import { compactReviewProofMessage } from '@/utils/reviewProofMessage'
import {
  buildSpeechOutputSummary,
  writeWindowSpeechOutputSummary,
} from '@/utils/speechOutputParitySummary'

// セッションIDを生成する関数
const generateSessionId = () => generateMessageId()

// コードブロックのデリミネーター
const CODE_DELIMITER = '```'

const getConfiguredMotionId = (tag: string): string => {
  const normalizedTag = tag.trim().toLowerCase()
  const poseConfigs = settingsStore.getState().poseConfigs ?? []
  const matchedPose = poseConfigs.find(
    (pose) => pose.id.toLowerCase() === normalizedTag
  )
  return matchedPose?.id ?? ''
}

/**
 * AI判断機能でマルチモーダルを使用するかどうかを決定する
 * @param userMessage ユーザーメッセージ
 * @param image 画像データ
 * @param decisionPrompt AI判断用プロンプト
 * @returns 画像を使用するかどうか
 */
const askAIForMultiModalDecision = async (
  userMessage: string,
  image: string,
  decisionPrompt: string
): Promise<boolean> => {
  try {
    // 直近の会話履歴を取得（最新3つまで）
    const currentChatLog = homeStore.getState().chatLog
    const recentMessages = currentChatLog.slice(-3)

    // 会話履歴をテキストとして構築
    let conversationHistory = ''
    if (recentMessages.length > 0) {
      conversationHistory = '\n\n直近の会話履歴:\n'
      // cutImageMessage関数を使用して画像メッセージをテキストに変換
      const textOnlyMessages = messageSelectors.cutImageMessage(recentMessages)
      textOnlyMessages.forEach((msg, index) => {
        const content = msg.content || ''
        conversationHistory += `${index + 1}. ${msg.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${content}\n`
      })
    }

    // AI判断用のメッセージを構築
    const decisionMessage: Message = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Conversation History:\n${conversationHistory}\n\nUser Message: "${userMessage}"`,
        },
        { type: 'image', image: image },
      ],
      timestamp: new Date().toISOString(),
    }

    // AI判断用のシステムプロンプト
    const systemMessage: Message = {
      role: 'system',
      content: decisionPrompt,
    }

    // AIに判断を求める
    const response = await getAIChatResponseStream([
      systemMessage,
      decisionMessage,
    ])

    if (!response) {
      return false // エラーの場合は画像を使用しない
    }

    // ReadableStreamからテキストを取得
    const reader = response.getReader()
    let result = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += value
      }
    } finally {
      reader.releaseLock()
    }

    const decision = result.trim().toLowerCase()

    // 各言語の肯定的な回答をチェック
    const affirmativeResponses = [
      'はい',
      'yes',
      'oui',
      'sí',
      'ja',
      '是',
      '예',
      'tak',
      'da',
      'sim',
    ]
    return affirmativeResponses.some((response) => decision.includes(response))
  } catch (error) {
    console.error('AI判断でエラーが発生しました:', error)
    return false // エラーの場合は画像を使用しない
  }
}

/**
 * テキストから感情タグ `[...]` を抽出する
 * @param text 入力テキスト
 * @returns 感情タグと残りのテキスト
 */
const extractEmotion = (
  text: string
): { emotionTag: string; remainingText: string } => {
  // 先頭のスペースを無視して、感情タグを検出
  const emotionMatch = text.match(/^\s*\[(.*?)\]/)
  if (emotionMatch?.[0]) {
    const tagName = emotionMatch[1]?.trim() ?? ''
    // モーションタグは感情タグとして扱わない。
    // LLMが [motion:bow] を [bow] と短縮しても、後段でモーションとして拾う。
    if (/^motion:/i.test(tagName) || getConfiguredMotionId(tagName)) {
      return { emotionTag: '', remainingText: text }
    }
    return {
      emotionTag: emotionMatch[0].trim(), // タグ自体の前後のスペースは除去
      // 先頭のスペースも含めて削除し、さらに前後のスペースを除去
      remainingText: text
        .slice(text.indexOf(emotionMatch[0]) + emotionMatch[0].length)
        .trimStart(),
    }
  }
  return { emotionTag: '', remainingText: text }
}

/**
 * テキストからモーションタグ `[motion:xxx]` を抽出する
 * @param text 入力テキスト
 * @returns モーションタグと残りのテキスト
 */
const extractMotionTag = (
  text: string
): { motionTag: string; remainingText: string } => {
  const motionMatch = text.match(/^\s*\[motion:([^\]\s]+)\]/i)
  if (motionMatch?.[0]) {
    const configuredMotion = getConfiguredMotionId(motionMatch[1])
    return {
      motionTag: configuredMotion || motionMatch[1],
      remainingText: text
        .slice(text.indexOf(motionMatch[0]) + motionMatch[0].length)
        .trimStart(),
    }
  }
  const bareMotionMatch = text.match(/^\s*\[([A-Za-z_][A-Za-z0-9_-]*)\]/)
  if (bareMotionMatch?.[0]) {
    const motionTag = getConfiguredMotionId(bareMotionMatch[1])
    if (motionTag) {
      return {
        motionTag,
        remainingText: text
          .slice(text.indexOf(bareMotionMatch[0]) + bareMotionMatch[0].length)
          .trimStart(),
      }
    }
  }
  return { motionTag: '', remainingText: text }
}

/**
 * テキストから文法的に区切りの良い文を抽出する
 * @param text 入力テキスト
 * @returns 抽出された文と残りのテキスト
 */
const extractSentence = (
  text: string
): { sentence: string; remainingText: string } => {
  const sentenceMatch = text.match(
    /^(.{1,19}?(?:[。．.!?！？\n]|(?=\[))|.{20,}?(?:[、,。．.!?！？\n]|(?=\[)))/
  )
  if (sentenceMatch?.[0]) {
    return {
      sentence: sentenceMatch[0],
      remainingText: text.slice(sentenceMatch[0].length).trimStart(),
    }
  }
  return { sentence: '', remainingText: text }
}

type AssistantSpeechLink = {
  assistantMessageId?: string
  assistantTurnId?: string
  displayMessage?: string
}

const publishAssistantDisplayMessage = (
  messageId: string,
  content: string,
  thinking?: string
) => {
  const trimmedContent = content.trim()
  if (!trimmedContent) return

  homeStore.getState().upsertMessage({
    id: messageId,
    role: 'assistant',
    content: trimmedContent,
    ...(thinking && { thinking }),
  })
}

/**
 * 発話と関連する状態更新を行う
 * @param sessionId セッションID
 * @param sentence 発話する文
 * @param emotionTag 感情タグ (例: "[neutral]")
 * @param currentAssistantMessageListRef アシスタントメッセージリストの参照
 * @param currentSlideMessagesRef スライドメッセージリストの参照
 * @param motionTag モーションタグ (例: "think")
 */
const handleSpeakAndStateUpdate = (
  sessionId: string,
  sentence: string,
  emotionTag: string,
  currentAssistantMessageListRef: { current: string[] },
  currentSlideMessagesRef: { current: string[] },
  motionTag?: string,
  speechLink: AssistantSpeechLink = {}
) => {
  const hs = homeStore.getState()
  const emotion = emotionTag.includes('[')
    ? (emotionTag.slice(1, -1).toLowerCase() as EmotionType)
    : 'neutral'
  const outputMessage =
    compactReviewProofMessage(speechLink.displayMessage ?? sentence) || sentence

  // 発話不要/不可能な文字列だった場合はスキップ
  if (
    outputMessage === '' ||
    outputMessage.replace(
      /^[\s\u3000\t\n\r\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]'"''""・、。,.!?！？:：;；\-_=+~～*＊@＠#＃$＄%％^＾&＆|｜\\＼/／`｀]+$/gu,
      ''
    ) === ''
  ) {
    return false
  }
  writeWindowSpeechOutputSummary(
    buildSpeechOutputSummary({
      surface: 'tts_talk_message',
      sourceField: 'Talk.message',
      message: outputMessage,
      messageId: speechLink.assistantMessageId,
      turnId: speechLink.assistantTurnId ?? sessionId,
    })
  )

  speakCharacter(
    sessionId,
    {
      message: outputMessage,
      emotion: emotion,
      motion: motionTag || undefined,
      sourceMessageId: speechLink.assistantMessageId,
      sourceTurnId: speechLink.assistantTurnId ?? sessionId,
      displayMessage: outputMessage,
    },
    () => {
      hs.incrementChatProcessingCount()
      currentSlideMessagesRef.current.push(sentence)
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      })
    },
    () => {
      hs.decrementChatProcessingCount()
      currentSlideMessagesRef.current.shift()
      homeStore.setState({
        slideMessages: [...currentSlideMessagesRef.current],
      })
    }
  )

  return true
}

/**
 * 受け取ったメッセージを処理し、AIの応答を生成して発話させる (Refactored)
 * @param receivedMessage 処理する文字列
 */
export const speakMessageHandler = async (receivedMessage: string) => {
  const sessionId = generateSessionId()
  const currentSlideMessagesRef = { current: [] as string[] }
  const assistantMessageListRef = { current: [] as string[] }

  let isCodeBlock: boolean = false
  let codeBlockContent: string = ''
  let accumulatedAssistantText: string = ''
  let remainingMessage = receivedMessage
  let currentMessageId: string = generateMessageId()

  while (remainingMessage.length > 0 || isCodeBlock) {
    let processableText = ''
    let currentCodeBlock = ''

    if (isCodeBlock) {
      if (remainingMessage.includes(CODE_DELIMITER)) {
        const [codeEnd, ...rest] = remainingMessage.split(CODE_DELIMITER)
        currentCodeBlock = codeBlockContent + codeEnd
        codeBlockContent = ''
        remainingMessage = rest.join(CODE_DELIMITER).trimStart()
        isCodeBlock = false

        if (accumulatedAssistantText.trim()) {
          homeStore.getState().upsertMessage({
            id: currentMessageId,
            role: 'assistant',
            content: accumulatedAssistantText.trim(),
          })
          accumulatedAssistantText = ''
        }
        const codeBlockId = generateMessageId()
        homeStore.getState().upsertMessage({
          id: codeBlockId,
          role: 'code',
          content: currentCodeBlock,
        })

        currentMessageId = generateMessageId()
        continue
      } else {
        codeBlockContent += remainingMessage
        remainingMessage = ''
        continue
      }
    } else if (remainingMessage.includes(CODE_DELIMITER)) {
      const [beforeCode, ...rest] = remainingMessage.split(CODE_DELIMITER)
      processableText = beforeCode
      codeBlockContent = rest.join(CODE_DELIMITER)
      isCodeBlock = true
      remainingMessage = ''
    } else {
      processableText = remainingMessage
      remainingMessage = ''
    }

    if (processableText.length > 0) {
      let localRemaining = processableText.trimStart()
      while (localRemaining.length > 0) {
        const prevLocalRemaining = localRemaining
        const { emotionTag, remainingText: textAfterEmotion } =
          extractEmotion(localRemaining)
        const { motionTag, remainingText: textAfterMotion } =
          extractMotionTag(textAfterEmotion)
        const { sentence, remainingText: textAfterSentence } =
          extractSentence(textAfterMotion)

        if (sentence) {
          assistantMessageListRef.current.push(sentence)
          const aiText = emotionTag ? `${emotionTag} ${sentence}` : sentence
          accumulatedAssistantText += aiText + ' '
          publishAssistantDisplayMessage(
            currentMessageId,
            accumulatedAssistantText
          )
          handleSpeakAndStateUpdate(
            sessionId,
            sentence,
            emotionTag,
            assistantMessageListRef,
            currentSlideMessagesRef,
            motionTag || undefined,
            {
              assistantMessageId: currentMessageId,
              assistantTurnId: sessionId,
              displayMessage: sentence,
            }
          )
          localRemaining = textAfterSentence
        } else {
          if (localRemaining === prevLocalRemaining && localRemaining) {
            const finalSentence = textAfterMotion || localRemaining
            assistantMessageListRef.current.push(finalSentence)
            const aiText = emotionTag
              ? `${emotionTag} ${finalSentence}`
              : finalSentence
            accumulatedAssistantText += aiText + ' '
            publishAssistantDisplayMessage(
              currentMessageId,
              accumulatedAssistantText
            )
            handleSpeakAndStateUpdate(
              sessionId,
              finalSentence,
              emotionTag,
              assistantMessageListRef,
              currentSlideMessagesRef,
              motionTag || undefined,
              {
                assistantMessageId: currentMessageId,
                assistantTurnId: sessionId,
                displayMessage: finalSentence,
              }
            )
            localRemaining = ''
          } else {
            localRemaining = textAfterSentence
          }
        }
        if (
          localRemaining.length > 0 &&
          localRemaining === prevLocalRemaining &&
          !sentence
        ) {
          console.warn(
            'Potential infinite loop detected in speakMessageHandler, breaking. Remaining:',
            localRemaining
          )
          const finalSentence = localRemaining
          assistantMessageListRef.current.push(finalSentence)
          accumulatedAssistantText += finalSentence + ' '
          publishAssistantDisplayMessage(
            currentMessageId,
            accumulatedAssistantText
          )
          handleSpeakAndStateUpdate(
            sessionId,
            finalSentence,
            '',
            assistantMessageListRef,
            currentSlideMessagesRef,
            undefined,
            {
              assistantMessageId: currentMessageId,
              assistantTurnId: sessionId,
              displayMessage: finalSentence,
            }
          )
          break
        }
      }
    }

    if (isCodeBlock && codeBlockContent) {
      if (accumulatedAssistantText.trim()) {
        homeStore.getState().upsertMessage({
          id: currentMessageId,
          role: 'assistant',
          content: accumulatedAssistantText.trim(),
        })
        accumulatedAssistantText = ''
      }
      remainingMessage = codeBlockContent
      codeBlockContent = ''
    }
  }

  if (accumulatedAssistantText.trim()) {
    homeStore.getState().upsertMessage({
      id: currentMessageId,
      role: 'assistant',
      content: accumulatedAssistantText.trim(),
    })
  }
  if (isCodeBlock && codeBlockContent.trim()) {
    console.warn('Loop ended unexpectedly while in code block state.')
    homeStore.getState().upsertMessage({
      role: 'code',
      content: codeBlockContent.trim(),
    })
  }
}

/**
 * AIからの応答を処理する関数 (Refactored for chunk-by-chunk saving)
 * @param messages 解答生成に使用するメッセージの配列
 */
export const processAIResponse = async (messages: Message[]) => {
  const sessionId = generateSessionId()
  homeStore.setState({ chatProcessing: true })

  // 思考中ポーズの適用
  const ss = settingsStore.getState()
  const shouldApplyThinkingPose =
    ss.thinkingPoseEnabled && ss.modelType === 'vrm'
  if (shouldApplyThinkingPose) {
    const poseConfig = ss.poseConfigs.find((p) => p.id === ss.thinkingPoseId)
    if (poseConfig) {
      const model = homeStore.getState().viewer.model
      if (model) {
        void model.poseManager
          .applyPose(model, ss.thinkingPoseId, poseConfig)
          .catch((e: unknown) =>
            console.error('Failed to apply thinking pose:', e)
          )
      }
    }
  }
  const resetThinkingPose = () => {
    if (shouldApplyThinkingPose) {
      const model = homeStore.getState().viewer.model
      if (model?.poseManager.isActive) {
        model.poseManager.resetToIdle(model)
      }
    }
  }

  let stream

  const currentSlideMessagesRef = { current: [] as string[] }
  const assistantMessageListRef = { current: [] as string[] }

  try {
    stream = await getAIChatResponseStream(messages)
  } catch (e) {
    console.error(e)
    resetThinkingPose()
    homeStore.setState({ chatProcessing: false })
    return
  }

  if (stream == null) {
    resetThinkingPose()
    homeStore.setState({ chatProcessing: false })
    return
  }

  const reader = stream.getReader()
  let receivedChunksForSpeech = ''
  let currentMessageId: string | null = null
  let currentMessageContent = ''
  let currentEmotionTag = ''
  let currentMotionTag = ''
  let isCodeBlock = false
  let codeBlockContent = ''
  let currentThinkingContent = ''
  let hasSpeakBeenCalled = false
  let didStreamProcessingFail = false
  const getCurrentAssistantMessageId = () => {
    if (currentMessageId === null) {
      currentMessageId = generateMessageId()
    }
    return currentMessageId
  }

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (value) {
        // 思考チャンクの検出（THINKING_MARKERプレフィックス）
        if (value.startsWith(THINKING_MARKER)) {
          const thinkingChunk = value.substring(THINKING_MARKER.length)
          currentThinkingContent += thinkingChunk

          if (currentMessageId === null) {
            currentMessageId = generateMessageId()
          }
          homeStore.getState().upsertMessage({
            id: currentMessageId,
            role: 'assistant',
            content: currentMessageContent || '',
            thinking: currentThinkingContent,
          })
          // receivedChunksForSpeechには追加しない（読み上げ対象外）
        } else {
          let textToAdd = value

          if (!isCodeBlock) {
            const delimiterIndexInValue = value.indexOf(CODE_DELIMITER)
            if (delimiterIndexInValue !== -1) {
              textToAdd = value.substring(0, delimiterIndexInValue)
            }
          }

          if (currentMessageId === null) {
            currentMessageId = generateMessageId()
            currentMessageContent = textToAdd
            if (currentMessageContent) {
              homeStore.getState().upsertMessage({
                id: currentMessageId,
                role: 'assistant',
                content: currentMessageContent,
                ...(currentThinkingContent && {
                  thinking: currentThinkingContent,
                }),
              })
            }
          } else if (!isCodeBlock) {
            currentMessageContent += textToAdd

            if (textToAdd) {
              homeStore.getState().upsertMessage({
                id: currentMessageId,
                role: 'assistant',
                content: currentMessageContent,
                ...(currentThinkingContent && {
                  thinking: currentThinkingContent,
                }),
              })
            }
          }

          // assistantMessage is now derived from chatLog, no need to set it separately

          receivedChunksForSpeech += value
        }
      }

      let processableTextForSpeech = receivedChunksForSpeech
      receivedChunksForSpeech = ''

      while (processableTextForSpeech.length > 0) {
        const originalProcessableText = processableTextForSpeech

        if (isCodeBlock) {
          codeBlockContent += processableTextForSpeech
          processableTextForSpeech = ''

          const delimiterIndex = codeBlockContent.lastIndexOf(CODE_DELIMITER)

          if (
            delimiterIndex !== -1 &&
            delimiterIndex >=
              codeBlockContent.length -
                (originalProcessableText.length + CODE_DELIMITER.length - 1)
          ) {
            const actualCode = codeBlockContent.substring(0, delimiterIndex)
            const remainingAfterDelimiter = codeBlockContent.substring(
              delimiterIndex + CODE_DELIMITER.length
            )

            if (actualCode.trim()) {
              homeStore.getState().upsertMessage({
                role: 'code',
                content: actualCode,
              })
            }

            codeBlockContent = ''
            isCodeBlock = false
            currentEmotionTag = ''
            currentMotionTag = ''

            currentMessageId = generateMessageId()
            currentMessageContent = ''

            processableTextForSpeech = remainingAfterDelimiter.trimStart()
            continue
          } else {
            receivedChunksForSpeech = codeBlockContent + receivedChunksForSpeech
            codeBlockContent = ''
            break
          }
        } else {
          const delimiterIndex =
            processableTextForSpeech.indexOf(CODE_DELIMITER)
          if (delimiterIndex !== -1) {
            const beforeCode = processableTextForSpeech.substring(
              0,
              delimiterIndex
            )
            const afterDelimiterRaw = processableTextForSpeech.substring(
              delimiterIndex + CODE_DELIMITER.length
            )

            //
            let textToProcessBeforeCode = beforeCode.trimStart()
            while (textToProcessBeforeCode.length > 0) {
              const prevText = textToProcessBeforeCode
              const {
                emotionTag: extractedEmotion,
                remainingText: textAfterEmotion,
              } = extractEmotion(textToProcessBeforeCode)
              if (extractedEmotion) currentEmotionTag = extractedEmotion
              const {
                motionTag: extractedMotion,
                remainingText: textAfterMotion,
              } = extractMotionTag(textAfterEmotion)
              if (extractedMotion) currentMotionTag = extractedMotion
              const { sentence, remainingText: textAfterSentence } =
                extractSentence(textAfterMotion)

              if (sentence) {
                hasSpeakBeenCalled =
                  handleSpeakAndStateUpdate(
                    sessionId,
                    sentence,
                    currentEmotionTag,
                    assistantMessageListRef,
                    currentSlideMessagesRef,
                    currentMotionTag || undefined,
                    {
                      assistantMessageId: getCurrentAssistantMessageId(),
                      assistantTurnId: sessionId,
                      displayMessage: sentence,
                    }
                  ) || hasSpeakBeenCalled
                textToProcessBeforeCode = textAfterSentence
                if (!textAfterSentence) {
                  currentEmotionTag = ''
                  currentMotionTag = ''
                }
              } else {
                receivedChunksForSpeech =
                  textToProcessBeforeCode + receivedChunksForSpeech
                textToProcessBeforeCode = ''
                break
              }

              if (
                textToProcessBeforeCode.length > 0 &&
                textToProcessBeforeCode === prevText
              ) {
                console.warn('Speech processing loop stuck on:', prevText)
                receivedChunksForSpeech =
                  textToProcessBeforeCode + receivedChunksForSpeech
                break
              }
            }

            isCodeBlock = true
            codeBlockContent = ''

            const langMatch = afterDelimiterRaw.match(/^ *(\w+)? *\n/)
            let remainingAfterDelimiter = afterDelimiterRaw
            if (langMatch) {
              remainingAfterDelimiter = afterDelimiterRaw.substring(
                langMatch[0].length
              )
            }
            processableTextForSpeech = remainingAfterDelimiter
            continue
          } else {
            const {
              emotionTag: extractedEmotion,
              remainingText: textAfterEmotion,
            } = extractEmotion(processableTextForSpeech)
            if (extractedEmotion) currentEmotionTag = extractedEmotion
            const {
              motionTag: extractedMotion,
              remainingText: textAfterMotion,
            } = extractMotionTag(textAfterEmotion)
            if (extractedMotion) currentMotionTag = extractedMotion

            const { sentence, remainingText: textAfterSentence } =
              extractSentence(textAfterMotion)

            if (sentence) {
              hasSpeakBeenCalled =
                handleSpeakAndStateUpdate(
                  sessionId,
                  sentence,
                  currentEmotionTag,
                  assistantMessageListRef,
                  currentSlideMessagesRef,
                  currentMotionTag || undefined,
                  {
                    assistantMessageId: getCurrentAssistantMessageId(),
                    assistantTurnId: sessionId,
                    displayMessage: sentence,
                  }
                ) || hasSpeakBeenCalled
              processableTextForSpeech = textAfterSentence
              if (!textAfterSentence) {
                currentEmotionTag = ''
                currentMotionTag = ''
              }
            } else {
              receivedChunksForSpeech =
                processableTextForSpeech + receivedChunksForSpeech
              processableTextForSpeech = ''
              break
            }
          }
        }

        if (
          processableTextForSpeech.length > 0 &&
          processableTextForSpeech === originalProcessableText
        ) {
          console.warn(
            'Main speech processing loop stuck on:',
            originalProcessableText
          )
          receivedChunksForSpeech =
            processableTextForSpeech + receivedChunksForSpeech
          processableTextForSpeech = ''
          break
        }
      }

      if (done) {
        if (receivedChunksForSpeech.length > 0) {
          if (!isCodeBlock) {
            const finalSentence = receivedChunksForSpeech
            const { emotionTag: extractedEmotion, remainingText: finalText } =
              extractEmotion(finalSentence)
            if (extractedEmotion) currentEmotionTag = extractedEmotion
            const {
              motionTag: extractedMotion,
              remainingText: finalTextAfterMotion,
            } = extractMotionTag(finalText)
            if (extractedMotion) currentMotionTag = extractedMotion

            hasSpeakBeenCalled =
              handleSpeakAndStateUpdate(
                sessionId,
                finalTextAfterMotion,
                currentEmotionTag,
                assistantMessageListRef,
                currentSlideMessagesRef,
                currentMotionTag || undefined,
                {
                  assistantMessageId: getCurrentAssistantMessageId(),
                  assistantTurnId: sessionId,
                  displayMessage: finalTextAfterMotion,
                }
              ) || hasSpeakBeenCalled
          } else {
            console.warn(
              'Stream ended while still in code block state. Saving remaining code.',
              codeBlockContent
            )
            codeBlockContent += receivedChunksForSpeech
            if (codeBlockContent.trim()) {
              homeStore.getState().upsertMessage({
                role: 'code',
                content: codeBlockContent,
              })
            }
            codeBlockContent = ''
            isCodeBlock = false
          }
        }

        if (isCodeBlock && codeBlockContent.trim()) {
          console.warn(
            'Stream ended unexpectedly while in code block state. Saving buffered code.'
          )
          homeStore.getState().upsertMessage({
            role: 'code',
            content: codeBlockContent,
          })
          codeBlockContent = ''
          isCodeBlock = false
        }
        break
      }
    }
  } catch (e) {
    didStreamProcessingFail = true
    console.error('Error processing AI response stream:', e)
  } finally {
    reader.releaseLock()
  }

  if (didStreamProcessingFail || !hasSpeakBeenCalled) {
    resetThinkingPose()
  }
  homeStore.setState({
    chatProcessing: false,
  })

  if (currentMessageContent.trim()) {
    homeStore.getState().upsertMessage({
      id: currentMessageId ?? generateMessageId(),
      role: 'assistant',
      content: currentMessageContent.trim(),
      ...(currentThinkingContent && { thinking: currentThinkingContent }),
    })

    // IndexedDBにアシスタントメッセージを保存
    saveMessageToMemory({
      role: 'assistant',
      content: currentMessageContent.trim(),
    }).catch(() => {})
  }
  if (isCodeBlock && codeBlockContent.trim()) {
    console.warn(
      'Stream ended unexpectedly while in code block state. Saving buffered code.'
    )
    homeStore.getState().upsertMessage({
      role: 'code',
      content: codeBlockContent,
    })
    codeBlockContent = ''
    isCodeBlock = false
  }
}

/**
 * アシスタントとの会話を行う
 * 画面のチャット欄から入力されたときに実行される処理
 * Youtubeでチャット取得した場合もこの関数を使用する
 */
export const handleSendChatFn =
  () => async (text: string, userName?: string) => {
    const sessionId = generateSessionId()
    const newMessage = text
    const timestamp = new Date().toISOString()

    if (newMessage === null) return

    const ss = settingsStore.getState()
    const sls = slideStore.getState()
    const wsManager = webSocketStore.getState().wsManager
    const modalImage = homeStore.getState().modalImage

    if (ss.externalLinkageMode) {
      homeStore.setState({ chatProcessing: true })

      if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
        const userMessageContent: Message['content'] = modalImage
          ? [
              { type: 'text' as const, text: newMessage },
              { type: 'image' as const, image: modalImage },
            ]
          : newMessage

        homeStore.getState().upsertMessage({
          role: 'user',
          content: userMessageContent,
          timestamp: timestamp,
          userName: userName,
        })

        saveMessageToMemory({
          role: 'user',
          content: newMessage,
          timestamp: timestamp,
        }).catch(() => {})

        const wsPayload: { content: string; type: string; image?: string } = {
          content: newMessage,
          type: 'chat',
        }
        if (modalImage) {
          wsPayload.image = modalImage
        }
        wsManager.websocket.send(JSON.stringify(wsPayload))

        if (modalImage) {
          homeStore.setState({ modalImage: '' })
        }
      } else {
        toastStore.getState().addToast({
          message: i18next.t('NotConnectedToExternalAssistant'),
          type: 'error',
          tag: 'not-connected-to-external-assistant',
        })
        homeStore.setState({
          chatProcessing: false,
        })
      }
    } else if (ss.realtimeAPIMode) {
      if (wsManager?.websocket?.readyState === WebSocket.OPEN) {
        homeStore.getState().upsertMessage({
          role: 'user',
          content: newMessage,
          timestamp: timestamp,
          userName: userName,
        })

        saveMessageToMemory({
          role: 'user',
          content: newMessage,
          timestamp: timestamp,
        }).catch(() => {})
      }
    } else {
      let systemPrompt = ss.systemPrompt
      if (ss.slideMode) {
        if (sls.isPlaying) {
          return
        }

        try {
          let scripts = JSON.stringify(
            require(
              `../../../public/slides/${sls.selectedSlideDocs}/scripts.json`
            )
          )
          systemPrompt = systemPrompt.replace('{{SCRIPTS}}', scripts)

          let supplement = ''
          try {
            const response = await fetch(
              `/api/getSupplement?slideName=${sls.selectedSlideDocs}`
            )
            if (!response.ok) {
              throw new Error('Failed to fetch supplement')
            }
            const data = await response.json()
            supplement = data.supplement
            systemPrompt = systemPrompt.replace('{{SUPPLEMENT}}', supplement)
          } catch (e) {
            console.error('supplement.txtの読み込みに失敗しました:', e)
          }

          const answerString = await judgeSlide(newMessage, scripts, supplement)
          const answer = JSON.parse(answerString)
          if (answer.judge === 'true' && answer.page !== '') {
            goToSlide(Number(answer.page))
            systemPrompt += `\n\nEspecial Page Number is ${answer.page}.`
          }
        } catch (e) {
          console.error(e)
        }
      }

      homeStore.setState({ chatProcessing: true })

      // マルチモーダル対応チェック
      if (
        modalImage &&
        !isMultiModalAvailable(
          ss.selectAIService,
          ss.selectAIModel,
          ss.enableMultiModal,
          ss.multiModalMode,
          ss.customModel
        )
      ) {
        toastStore.getState().addToast({
          message: i18next.t('MultiModalNotSupported'),
          type: 'error',
          tag: 'multimodal-not-supported',
        })
        homeStore.setState({
          chatProcessing: false,
          modalImage: '',
        })
        return
      }

      // マルチモーダルモードに基づいてメッセージコンテンツを構築
      let userMessageContent: Message['content'] = newMessage
      let shouldUseImage = false

      if (modalImage) {
        switch (ss.multiModalMode) {
          case 'always':
            shouldUseImage = true
            break
          case 'never':
            shouldUseImage = false
            break
          case 'ai-decide':
            // AI判断モードの場合は、AIに判断を求める
            shouldUseImage = await askAIForMultiModalDecision(
              newMessage,
              modalImage,
              ss.multiModalAiDecisionPrompt
            )
            break
        }

        if (shouldUseImage) {
          userMessageContent = [
            { type: 'text' as const, text: newMessage },
            { type: 'image' as const, image: modalImage },
          ]
        }
      }

      homeStore.getState().upsertMessage({
        role: 'user',
        content: userMessageContent,
        timestamp: timestamp,
        userName: userName,
      })

      // IndexedDBにユーザーメッセージを保存
      saveMessageToMemory({
        role: 'user',
        content:
          typeof userMessageContent === 'string'
            ? userMessageContent
            : newMessage,
        timestamp: timestamp,
      }).catch(() => {})

      if (modalImage) {
        homeStore.setState({ modalImage: '' })
      }

      // ポーズ設定からモーションタグ情報をシステムプロンプトに追加
      const poseConfigs = ss.poseConfigs
      if (poseConfigs.length > 0) {
        const motionIds = poseConfigs.map((p) => p.id).join(', ')
        systemPrompt +=
          '\n\nモーションタグを使うことで、キャラクターのポーズを制御できます。' +
          `利用可能なモーション: ${motionIds}\n` +
          '書式: [motion:モーション名]  例: [motion:think]\n' +
          '感情タグと併用可能です。例: [happy][motion:cheer]やったー！'
      }

      // IndexedDBから関連する過去の記憶を検索してsystemPromptに追加
      const memoryContext = await searchMemoryContext(newMessage)
      if (memoryContext) {
        systemPrompt = systemPrompt + '\n\n' + memoryContext
      }

      const currentChatLog = homeStore.getState().chatLog

      const messages: Message[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...messageSelectors.getProcessedMessages(
          currentChatLog,
          ss.includeTimestampInUserMessage
        ),
      ]

      try {
        await processAIResponse(messages)
      } catch (e) {
        console.error(e)
        // 思考中ポーズのリセット
        if (ss.thinkingPoseEnabled && ss.modelType === 'vrm') {
          const model = homeStore.getState().viewer.model
          if (model?.poseManager.isActive) {
            model.poseManager.resetToIdle(model)
          }
        }
        homeStore.setState({ chatProcessing: false })
      }
    }
  }

/**
 * WebSocketからのテキストを受信したときの処理
 */
export const handleReceiveTextFromWsFn =
  () =>
  async (
    text: string,
    role?: string,
    emotion: EmotionType = 'neutral',
    type?: string,
    image?: string
  ) => {
    const sessionId = generateSessionId()
    if (text === null || role === undefined) return

    const ss = settingsStore.getState()
    const hs = homeStore.getState()
    const wsManager = webSocketStore.getState().wsManager

    if (ss.externalLinkageMode) {
      console.log('ExternalLinkage Mode: true')
    } else {
      console.log('ExternalLinkage Mode: false')
      return
    }

    homeStore.setState({ chatProcessing: true })

    if (role !== 'user') {
      let assistantMessageId: string | undefined
      if (type === 'start') {
        // startの場合は何もしない（textは空文字のため）
        console.log('Starting new response')
        wsManager?.setTextBlockStarted(false)
      } else if (
        hs.chatLog.length > 0 &&
        hs.chatLog[hs.chatLog.length - 1].role === role &&
        wsManager?.textBlockStarted
      ) {
        // 既存のメッセージに追加（IDを維持）
        const lastMessage = hs.chatLog[hs.chatLog.length - 1]
        const lastContent =
          typeof lastMessage.content === 'string'
            ? lastMessage.content
            : Array.isArray(lastMessage.content)
              ? lastMessage.content[0].text
              : ''

        const appendedText = lastContent + text
        const appendedContent: Message['content'] = Array.isArray(
          lastMessage.content
        )
          ? [
              { type: 'text' as const, text: appendedText },
              lastMessage.content[1],
            ]
          : appendedText

        const appendedMessageId = lastMessage.id ?? generateMessageId()
        assistantMessageId =
          role === 'assistant' ? appendedMessageId : undefined
        homeStore.getState().upsertMessage({
          id: appendedMessageId,
          role: role,
          content: appendedContent,
        })
      } else {
        // 新しいメッセージを追加（新規IDを生成）
        const messageContent: Message['content'] = image
          ? [
              { type: 'text' as const, text: text },
              { type: 'image' as const, image: image },
            ]
          : text

        assistantMessageId =
          role === 'assistant' ? generateMessageId() : undefined
        homeStore.getState().upsertMessage({
          ...(assistantMessageId && { id: assistantMessageId }),
          role: role,
          content: messageContent,
        })
        wsManager?.setTextBlockStarted(true)
      }

      if (role === 'assistant' && text !== '') {
        try {
          // 文ごとに音声を生成 & 再生、返答を表示
          speakCharacter(
            sessionId,
            {
              message: text,
              emotion: emotion,
              sourceMessageId: assistantMessageId,
              sourceTurnId: sessionId,
              displayMessage: text,
            },
            () => {
              // assistantMessage is now derived from chatLog, no need to set it separately
            },
            () => {
              // hs.decrementChatProcessingCount()
            }
          )
        } catch (e) {
          console.error('Error in speakCharacter:', e)
        }
      }

      if (type === 'end') {
        // レスポンスの終了処理
        console.log('Response ended')
        wsManager?.setTextBlockStarted(false)
        homeStore.setState({ chatProcessing: false })
      }
    }

    homeStore.setState({ chatProcessing: type !== 'end' })
  }

/**
 * RealtimeAPIからのテキストまたは音声データを受信したときの処理
 */
export const handleReceiveTextFromRtFn = () => {
  // 連続する response.audio イベントで共通の sessionId を使用するための変数
  let currentSessionId: string | null = null

  return async (
    text?: string,
    role?: string,
    type?: string,
    buffer?: ArrayBuffer
  ) => {
    // type が `response.audio` かつ currentSessionId が未設定の場合に新しいセッションIDを発番
    // それ以外の場合は既存の sessionId を使い続ける。
    // レスポンス終了（content_part.done 等）時にリセットする。

    if (currentSessionId === null) {
      currentSessionId = generateSessionId()
    }

    const sessionId = currentSessionId

    const ss = settingsStore.getState()
    const hs = homeStore.getState()

    if (ss.realtimeAPIMode) {
      console.log('realtime api mode: true')
    } else if (ss.audioMode) {
      console.log('audio mode: true')
    } else {
      console.log('realtime api mode: false')
      return
    }

    homeStore.setState({ chatProcessing: true })

    if (role == 'assistant') {
      if (type?.includes('response.audio') && buffer !== undefined) {
        console.log('response.audio:')
        try {
          speakCharacter(
            sessionId,
            {
              emotion: 'neutral',
              message: '',
              buffer: buffer,
            },
            () => {},
            () => {}
          )
        } catch (e) {
          console.error('Error in speakCharacter:', e)
        }
      } else if (type === 'response.content_part.done' && text !== undefined) {
        homeStore.getState().upsertMessage({
          role: role,
          content: text,
        })
      }
    }
    homeStore.setState({ chatProcessing: false })

    // レスポンスが完了したらセッションIDをリセット
    if (type === 'response.content_part.done') {
      currentSessionId = null
    }
  }
}
