# The lab

`library/` holds the lab's sequences, one to a FASTA file, and `enzymes.tsv` the restriction enzymes it has and where each cuts. A question names a file, and sometimes a stretch of it.

How the lab reads its questions:

- Positions count from 1 along the sequence as its file gives it, and "bases 120 to 480" includes both ends. A sequence is linear and double-stranded; its file gives the top strand, 5′ to 3′.
- An open reading frame (ORF) runs from an ATG to the first stop codon (TAA, TAG or TGA) in the same frame, on either strand. An ATG inside an ORF starts no other ORF in that frame, and a frame with no stop before the sequence ends has no ORF there. An ORF's protein is its translation by the standard code, without the stop, and its length is the protein's, in amino acids.
- A digest cuts the top strand at every site of every enzyme it names. In `enzymes.tsv`, `cut` is how many bases of the site come before the cut. Fragment lengths are counted on the top strand, in order from base 1.
- A primer is written 5′ to 3′. Its Tm is 2 °C for each A or T and 4 °C for each G or C. A PCR product runs from the 5′ end of one primer to the 5′ end of the other, tails included.
