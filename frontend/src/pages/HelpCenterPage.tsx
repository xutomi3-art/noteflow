import { Link } from 'react-router-dom';

export default function HelpCenterPage() {
  return (
    <div className="min-h-screen bg-[#f8f9fa] py-16 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/dashboard" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-900 transition-colors mb-8 font-medium">
          &larr; Back
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-10 md:p-14">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Help Center</h1>
          <p className="text-sm text-slate-400 mb-10">Find answers to common questions about using Noteflow.</p>

          <div className="space-y-10 text-[15px] leading-relaxed text-slate-700">
            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Getting Started</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">What is Noteflow?</h3>
                  <p>Noteflow is an AI-powered knowledge base that lets you upload documents, ask questions, and get accurate answers with citations back to your source material. Think of it as a personal research assistant that deeply understands your documents.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">How do I create a notebook?</h3>
                  <p>Click the "Create New" button on the dashboard and choose between a Personal Notebook (private to you) or a Team Notebook (shareable with others). Give it a name, optionally upload some documents, and you are ready to go.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">What file types are supported?</h3>
                  <p>Noteflow supports PDF, DOCX, PPTX, TXT, Markdown (.md), Excel (.xlsx, .xls), CSV, and images (JPG, PNG, WebP, GIF, BMP). Each file can be up to 50 MB, and each notebook can hold up to 50 files.</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">AI Chat and Citations</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">How does the AI answer questions?</h3>
                  <p>When you ask a question, Noteflow searches through all your uploaded documents using a combination of semantic search and keyword matching. It retrieves the most relevant passages and generates an answer grounded in your source material.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">What are citations?</h3>
                  <p>Citations appear as numbered markers like [1], [2] in the AI response. Each citation links back to a specific passage in your source documents. Click on a citation to see the exact excerpt and the source file it came from.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">Can I scope questions to specific sources?</h3>
                  <p>Yes. In the sources panel on the left, you can check or uncheck individual sources. When sources are selected, the AI will only search within those documents when answering your questions.</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Studio Features</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">What can I generate in the Studio?</h3>
                  <p>The Studio panel (on the right side of the notebook) offers several AI-powered tools:</p>
                  <ul className="list-disc pl-6 mt-2 space-y-1">
                    <li><strong>Summary:</strong> A concise overview of all your uploaded documents.</li>
                    <li><strong>FAQ:</strong> Automatically generated frequently asked questions based on your content.</li>
                    <li><strong>Study Guide:</strong> A structured guide for learning the material in your documents.</li>
                    <li><strong>Mind Map:</strong> A visual mind map of the key concepts and their relationships.</li>
                    <li><strong>Podcast:</strong> An audio summary generated from your documents.</li>
                    <li><strong>PPT:</strong> A presentation generated from your document content.</li>
                    <li><strong>Saved Notes:</strong> Your own notes and bookmarked content.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Sharing and Collaboration</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">How do I share a notebook?</h3>
                  <p>Open the notebook and click the "Share" button in the header. You can generate an invite link and choose a role (Editor or Viewer) for people who join. Share the link with your collaborators.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">What are the different roles?</h3>
                  <ul className="list-disc pl-6 mt-2 space-y-1">
                    <li><strong>Owner:</strong> Full control including deleting the notebook and managing members.</li>
                    <li><strong>Editor:</strong> Can upload documents, ask questions, and use all features.</li>
                    <li><strong>Viewer:</strong> Can view documents and ask questions but cannot upload or modify content.</li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Troubleshooting</h2>
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">My document is stuck on "Processing"</h3>
                  <p>Document processing typically takes 30 seconds to a few minutes depending on the file size and type. PDF and PPTX files may take longer. If a document is stuck for more than 10 minutes, try deleting it and re-uploading.</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-1.5">The AI answer does not seem accurate</h3>
                  <p>Make sure your question is specific and relates to the content in your uploaded documents. The AI can only answer based on the information in your sources. Try rephrasing your question or uploading additional relevant documents.</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-900 mb-4">Contact Support</h2>
              <p>If you need further assistance, please reach out to us at <a href="mailto:support@noteflow.app" className="text-[#5b8c15] hover:underline">support@noteflow.app</a>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
