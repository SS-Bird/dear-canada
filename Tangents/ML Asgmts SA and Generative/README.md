# Sentiment towards Immigration in Dear Canada: 

_Find full walk through in the_pipe.ipynb notebook, or in the pdf._

This project set out to build a multi-label sentence-level sentiment classifier capable of identifying Positive, Negative, and Neutral tones simultaneously within narrative text. This was treated  as a multi-label problem rather than a traditional multiclass task because emotional categories are rarely mutually exclusive; a sentence may express gratitude and grief at the same time. Especially in the context of books with a tendancy to be depressing, yet never too depressing for kids and always ending happily. 

In retrospective, it has become obvious that two tasks were muddled here. There is one classification problem, to identify whether a sentence is related to immigration, and another classification problem, to identify what sentiment each sentence communicates. I believe that labeling system and approach would radically change the class imbalance issue, which is the major limiting factor, aside from shear quantity of data. The _With Nothing but Our Courage_ example paragraph shows the fundemental labeling scheme issue too; the models  classification made more sense then the actual labels. I was too deep in data labeling to change systems, especially because I already had once. 

We chose to represent sentences using DistilBERT CLS embeddings rather than traditional bag-of-words or TF-IDF features. This decision prioritized contextual meaning over lexical frequency. Because the dataset was not large enough to justify fine-tuning a transformer model end-to-end, we froze DistilBERT and used it strictly as a feature extractor. DistilBert has millions of parameters, so fine tuning it on so few minority class examples likely lead to overfitting and high variance across runs. The current approach allowed us to test how far high-quality pretrained embeddings could carry relatively simple linear classifiers.

For classification, we implemented both Logistic Regression and Linear SVM models, training three independent classifiers—one for each sentiment label. This independence assumption is structurally imperfect. Positive and Negative labels, for example, are not statistically independent in practice. However, decoupling them allowed us to tune each model individually and interpret each boundary separately. It also made threshold tuning feasible in a clean and controlled way.

Regularization became especially important because we were working in a 768-dimensional embedding space. Without L2 regularization, the models could easily overfit, especially given class imbalance. The hyperparameter C was tuned per label, and we observed that optimal regularization strength varied across Positive, Negative, and Neutral tasks. Classification threshold for Logistic Regression was also tuned. Elsewhere, we prioritise recall (for example, by balancing the class weight) but here we optimise with F1 for balance with precision and actually increase the threshold. 

The manual sentence-level evaluation section provided the most illuminating diagnostic. The heatmaps visualizing predicted probabilities, manual labels, and correctness matrices make visible what aggregate metrics obscure. For clearly polarized sentences, the models performed confidently and correctly. For emotionally mixed sentences, predictions were often split across labels—sometimes correctly reflecting complexity, sometimes revealing ambiguity in the learned boundary. The Neutral category in particular showed instability, suggesting either labeling ambiguity or weaker signal in embedding space.

Interestingly, Linear SVM and Logistic Regression often produced similar large-scale performance patterns. Linear SVM performed slightly better, but the probabilistic nature of Logistic Regression made it more interpretable and tunable. We could apply these models to average sentence level prediction/probabilities over each diary entry, to see the high level progression of immigration sentiment, in which case the probabilities of Logistic regression might be more informative then the prediction of SVM. 

There are clear limitations. First, embeddings were frozen; we did not adapt the representation space to the task. Second, labels were modeled independently, ignoring structural relationships between sentiments. Third, all decision boundaries were linear. Emotional tone in narrative text may not be linearly separable in embedding space. More then anything, the data needs to be revised and there needs to be more of it. 

Despite these limitations, the pipeline demonstrates that contextual embeddings combined with relatively simple linear classifiers can produce meaningful multi-label sentiment predictions. Unsupervised learning might suggest a route around the current data issues. 


Find data labeling here:
* A Sea of Sorrows: 
    * https://docs.google.com/spreadsheets/d/1wD1FXjlnSc4dNbAMG-ao3kaJ703kUrh9fN_qmiUsESQ/edit?usp=sharing

* With Nothing but Our Courage:
    * https://docs.google.com/spreadsheets/d/1mNxHFrLdaTxogkuXRKXPAowVM5RVcLqj4_0_fg9J7JY/edit?usp=sharing

* Alone in an Untamed Land: 
    * https://docs.google.com/spreadsheets/d/11Oo0RVQLp67KDq-6aKBtkG4sJUH1M-a48dOulzs0nRw/edit?usp=sharing 

* A Desperate Road to Freedom: 
    * https://docs.google.com/spreadsheets/d/1kUvav-Nw_3gy3ovdhktnaEf96SWWYTk-TzwVFTJ07IY/edit?usp=sharing

* Footsteps in the Snow
    * https://docs.google.com/spreadsheets/d/1lgwuJVaU-7Kv44IyCcicrF-7f_u8I6FdE7L4DFfPrq4/edit?usp=sharing

* A Prarie as Wide as the Sea
    * https://docs.google.com/spreadsheets/d/1fY5A0q57KMEGZ7heqP8C_8vT5zov41t6owsUj_uwfKg/edit?usp=sharing 


